#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Deliberation } from './core/deliberation.js';
import { ContextBuilder } from './core/context-builder.js';
import { createExecutionTrace } from './core/execution-trace.js';
import { formatDoctorResult, runDoctor as defaultRunDoctor } from './core/preflight.js';
import { resolveRuntimeConfig } from './core/runtime-config.js';
import {
  appendSessionRun,
  createSession,
  loadSession,
  pruneExpiredSessions,
  updateSessionFiles,
  updateSessionMemory,
  type DeliberationSession,
  type SessionTrackedFile,
} from './core/session-store.js';
import { failLine, renderColorHeader, detectColorSupport, createColors } from './util/format.js';
import { TerminalReporter } from './util/terminal-reporter.js';
import { detectLauncher, buildLauncherFromMode, formatRunExample, formatUpdateCommand, type LauncherInfo } from './util/launcher.js';
import { loadUserConfig, saveUserConfig, type UserConfig } from './util/user-config.js';
import { buildFileDelta, captureFileSnapshot } from './util/file-snapshot.js';
import { getSessionSnapshotsDir } from './util/session-paths.js';
import type { ExecutionTrace } from './core/execution-trace.js';
import type { ModelSource, ReasoningEffort, RuntimeConfig } from './core/runtime-config.js';
import type {
  DeliberationContext,
  DeliberationMode,
  DeliberationResult,
  FileContext,
  Adapter,
  FileDelta,
} from './core/types.js';
import type { InstallSkillResult } from './install.js';
import { DEFAULT_CONFIG, DeliberationError } from './core/types.js';
import { CodexCliAdapter } from './adapters/codex-cli.js';

function getPackageVersion(): string {
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 5; i++) {
      const pkg = resolve(dir, 'package.json');
      try {
        const json = JSON.parse(readFileSync(pkg, 'utf8'));
        if (json.name === 'opinionate' && json.version) return json.version;
      } catch { /* continue */ }
      dir = dirname(dir);
    }
  } catch { /* ignore */ }
  return '0.0.0';
}

function getErrorRemedy(error: unknown): string | undefined {
  if (!(error instanceof DeliberationError)) return undefined;
  switch (error.code) {
    case 'ADAPTER_UNAVAILABLE':
      return 'Codex CLI not found. Run: npm install -g @openai/codex';
    case 'ADAPTER_TIMEOUT':
      return 'Peer timed out. Try: --reasoning-effort medium --retry-on-timeout';
    case 'ADAPTER_ERROR':
      if (error.message.toLowerCase().includes('auth'))
        return 'Codex auth failed. Run: codex login';
      if (error.message.toLowerCase().includes('usage limit') || error.message.toLowerCase().includes('purchase more credits'))
        return 'Codex usage limit reached. Check https://chatgpt.com/codex/settings/usage or wait for credits to reset.';
      return 'Peer error. Run with --verbose --show-peer-output for details';
    default:
      return undefined;
  }
}

type CliArgs = Record<string, string | boolean | undefined>;

interface CliIO {
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
}

interface FileLoadDependencies {
  exists: (path: string) => boolean;
  sizeBytes: (path: string) => number;
  readText: (path: string) => string;
}

export interface AdapterFactoryOptions {
  timeout: number;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  modelSource: ModelSource;
  codexBin: string;
  trace: ExecutionTrace;
}

export interface RunCliDependencies {
  io?: CliIO;
  env?: Record<string, string | undefined>;
  cwd?: () => string;
  runDoctor?: typeof defaultRunDoctor;
  resolveAdapter?: (name: string, options: AdapterFactoryOptions) => Adapter;
  installSkill?: (targetDir?: string) => Promise<InstallSkillResult>;
}

function createDefaultIO(): CliIO {
  return {
    stdout: (chunk) => process.stdout.write(chunk),
    stderr: (chunk) => process.stderr.write(chunk),
  };
}

function log(io: CliIO, message: string): void {
  io.stderr(`${message}\n`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  const raw = argv.slice(2);

  if (raw[0] && !raw[0].startsWith('--')) {
    args._command = raw[0];
    raw.shift();
  }

  for (let index = 0; index < raw.length; index++) {
    const current = raw[index]!;
    if (!current.startsWith('--')) {
      continue;
    }

    const key = current.slice(2);
    const next = raw[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index++;
    } else {
      args[key] = true;
    }
  }

  return args;
}

function printUsage(io: CliIO): void {
  log(io, 'Usage: opinionate run --mode <mode> --task <task> [options]');
  log(io, '       opinionate continue --session <id> [options]');
  log(io, '       opinionate doctor [options]');
  log(io, '       opinionate install');
  log(io, '');
  log(io, 'Commands:');
  log(io, '  run      Run a deliberation session');
  log(io, '  continue Resume a persisted deliberation session');
  log(io, '  doctor   Check Codex, model, skill, and binary readiness');
  log(io, '  install  Install the Claude Code skill into .claude/skills');
  log(io, '');
  log(io, 'Options for run/doctor:');
  log(io, '  --cwd <path>                        Working directory (default: current directory)');
  log(io, '  --timeout <ms>                      Per-round timeout in ms (default: 60000)');
  log(io, '  --context-budget <bytes>            Max context size (default: 50000)');
  log(io, '  --model <name>                      Model override for Codex peer');
  log(io, '  --reasoning-effort <level>          Override peer reasoning effort');
  log(io, '  --codex-bin <path>                  Codex binary path (default: codex)');
  log(io, '  --file-strategy <auto|inline|reference>  Control whether file contents or paths are sent');
  log(io, '  --retry-on-timeout                  Retry timed-out rounds with reduced file context');
  log(io, '  --verbose                           Print peer execution details to stderr');
  log(io, '  --trace-dir <path>                  Persist per-round JSON trace artifacts');
  log(io, '  --show-peer-command                 Print the exact Codex command line');
  log(io, '  --show-peer-output                  Stream peer stdout/stderr to stderr');
  log(io, '  --persist-session                   Persist this run so it can be resumed later');
  log(io, '');
  log(io, 'Options for run/continue:');
  log(io, '  --mode <plan|review|debug|decide>   Deliberation mode (required)');
  log(io, '  --task <description>                Task to deliberate on (required)');
  log(io, '  --files <path1,path2,...>           Comma-separated file paths');
  log(io, '  --git-log                           Include recent git history');
  log(io, '  --conversation-summary <text>       Current conversation context');
  log(io, '  --max-rounds <n>                    Max deliberation rounds (default: 5)');
  log(io, '  --peer-adapter <name>               Peer adapter (default: codex-cli)');
  log(io, '  --orchestrator-adapter <name>       Orchestrator adapter');
  log(io, '  --session <id>                      Session id for `continue`');
}

function isDocLikePath(path: string): boolean {
  return /\.(md|mdx|txt|rst)$/i.test(path) || /(^|\/)(docs|plans|specs)\//.test(path);
}

function shouldLoadFilesByReference(
  files: Array<{ path: string; sizeBytes?: number }>,
  fileStrategy: DeliberationContext['fileStrategy'],
  contextBudget: number,
): boolean {
  if (fileStrategy === 'reference') {
    return true;
  }

  if (fileStrategy !== 'auto') {
    return false;
  }

  const totalSize = files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0);
  return files.some((file) => isDocLikePath(file.path)) || totalSize > contextBudget * 0.6;
}

const defaultFileLoadDependencies: FileLoadDependencies = {
  exists: existsSync,
  sizeBytes: (path) => statSync(path).size,
  readText: (path) => readFileSync(path, 'utf8'),
};

export function loadFilesForContext(
  filePaths: string,
  cwd: string,
  io: CliIO,
  options: {
    fileStrategy: DeliberationContext['fileStrategy'];
    contextBudget: number;
  },
  dependencies: FileLoadDependencies = defaultFileLoadDependencies,
): FileContext[] {
  const paths = filePaths.split(',').map((path) => path.trim()).filter(Boolean);
  const files: Array<FileContext & { fullPath: string }> = [];

  for (const path of paths) {
    const fullPath = resolve(cwd, path);
    if (!dependencies.exists(fullPath)) {
      log(io, `Warning: File not found: ${path}`);
      continue;
    }

    try {
      files.push({
        path,
        fullPath,
        sizeBytes: dependencies.sizeBytes(fullPath),
      });
    } catch {
      log(io, `Warning: Could not inspect file ${path}`);
    }
  }

  if (shouldLoadFilesByReference(files, options.fileStrategy, options.contextBudget)) {
    return files.map(({ fullPath: _fullPath, ...file }) => file);
  }

  const loaded: FileContext[] = [];
  for (const file of files) {
    try {
      const content = dependencies.readText(file.fullPath);
      loaded.push({
        path: file.path,
        content,
        sizeBytes: file.sizeBytes ?? Buffer.byteLength(content, 'utf8'),
      });
    } catch {
      log(io, `Warning: Could not read file ${file.path}`);
    }
  }

  return loaded;
}

function getGitLog(cwd: string): string | undefined {
  try {
    return execSync('git log --oneline -20', {
      cwd,
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
  } catch {
    return undefined;
  }
}

function buildContext(
  args: CliArgs,
  runtimeConfig: RuntimeConfig,
  cwd: string,
  io: CliIO,
  task: string,
): DeliberationContext {
  const context: DeliberationContext = {
    task,
    cwd,
    fileStrategy: runtimeConfig.fileStrategy,
    persistSession: runtimeConfig.persistSession,
  };

  if (typeof args.files === 'string') {
    context.files = loadFilesForContext(args.files, cwd, io, {
      fileStrategy: runtimeConfig.fileStrategy,
      contextBudget: runtimeConfig.contextBudget,
    });
  }

  if (args['git-log']) {
    context.gitLog = getGitLog(cwd);
  }

  if (typeof args['conversation-summary'] === 'string') {
    context.conversationSummary = args['conversation-summary'];
  }

  return context;
}

function filterSafeFiles(cwd: string, files: FileContext[] | undefined, budget: number): FileContext[] {
  if (!files || files.length === 0) {
    return [];
  }
  return new ContextBuilder(budget, cwd).filterFiles(files);
}

function readSnapshotText(cwd: string, sessionId: string, snapshotFile: string): string {
  return readFileSync(join(getSessionSnapshotsDir(cwd, sessionId), snapshotFile), 'utf8');
}

function readContextFileContent(cwd: string, file: FileContext): string | undefined {
  if (typeof file.content === 'string') {
    return file.content;
  }

  try {
    return readFileSync(resolve(cwd, file.path), 'utf8');
  } catch {
    return undefined;
  }
}

function buildSessionFileDeltas(
  cwd: string,
  session: DeliberationSession,
  files: FileContext[],
): FileDelta[] {
  const previousByPath = new Map(session.files.map((file) => [file.path, file]));
  const deltas: FileDelta[] = [];
  let totalBytes = 0;
  const currentPaths = new Set<string>();

  for (const file of files) {
    currentPaths.add(file.path);
    const previous = previousByPath.get(file.path);
    if (!previous?.snapshotFile) {
      deltas.push({
        path: file.path,
        status: 'added',
        summary: 'file newly added to session; read from disk',
        changedLineCount: readContextFileContent(cwd, file)?.split(/\r?\n/).length ?? 0,
      });
      continue;
    }

    const currentContent = readContextFileContent(cwd, file);
    if (typeof currentContent !== 'string') {
      deltas.push({
        path: file.path,
        status: 'changed',
        summary: 'file changed (unable to load current content; read from disk)',
        changedLineCount: 0,
      });
      continue;
    }

    const delta = buildFileDelta({
      path: file.path,
      previousContent: readSnapshotText(cwd, session.id, previous.snapshotFile),
      currentContent,
      maxBytes: 8 * 1024,
    });

    if (!delta) {
      continue;
    }

    const estimatedSize = Buffer.byteLength(delta.diff ?? delta.summary, 'utf8');
    if (totalBytes + estimatedSize > 24 * 1024) {
      deltas.push({
        path: file.path,
        status: 'changed',
        summary: 'file changed (delta omitted to stay within budget; read from disk)',
        changedLineCount: delta.changedLineCount,
      });
      continue;
    }

    deltas.push(delta);
    totalBytes += estimatedSize;
  }

  for (const previous of session.files) {
    if (currentPaths.has(previous.path)) {
      continue;
    }

    let previousContent = '';
    try {
      if (previous.snapshotFile) {
        previousContent = readSnapshotText(cwd, session.id, previous.snapshotFile);
      }
    } catch {
      previousContent = '';
    }

    const changedLineCount = previousContent
      ? previousContent.split(/\r?\n/).length
      : 0;
    const summary = 'file removed from session; prior content should not be assumed current';
    const estimatedSize = Buffer.byteLength(summary, 'utf8');

    if (totalBytes + estimatedSize > 24 * 1024) {
      deltas.push({
        path: previous.path,
        status: 'removed',
        summary: 'file removed from session (summary truncated to stay within budget)',
        changedLineCount,
      });
      continue;
    }

    deltas.push({
      path: previous.path,
      status: 'removed',
      summary,
      changedLineCount,
    });
    totalBytes += estimatedSize;
  }

  return deltas;
}

async function persistSessionArtifacts(
  cwd: string,
  sessionId: string,
  mode: DeliberationMode,
  context: DeliberationContext,
  result: DeliberationResult,
): Promise<void> {
  if (!result.sessionMemory) {
    return;
  }

  const safeFiles = filterSafeFiles(cwd, context.files, DEFAULT_CONFIG.contextBudget);
  const snapshotsDir = getSessionSnapshotsDir(cwd, sessionId);
  const trackedFiles: SessionTrackedFile[] = [];

  for (const file of safeFiles) {
    if ((file.sizeBytes ?? 0) > 200 * 1024) {
      continue;
    }

    const content = readContextFileContent(cwd, file);
    if (typeof content !== 'string') {
      continue;
    }

    if (Buffer.byteLength(content, 'utf8') > 200 * 1024) {
      continue;
    }

    const snapshot = await captureFileSnapshot(snapshotsDir, {
      path: file.path,
      content,
    });

    trackedFiles.push({
      path: file.path,
      sha256: snapshot.sha256,
      sizeBytes: snapshot.sizeBytes,
      lastIncludedAt: Date.now(),
      snapshotFile: snapshot.snapshotFile,
    });
  }

  await updateSessionMemory(cwd, sessionId, result.sessionMemory);
  await updateSessionFiles(cwd, sessionId, trackedFiles);
  await appendSessionRun(cwd, sessionId, {
    id: `run-${Date.now()}`,
    startedAt: Date.now(),
    completedAt: Date.now(),
    mode,
    task: context.task,
    rounds: result.rounds,
    agreed: result.agreed,
    partialRounds: result.partialRounds,
    summary: result.summary,
  });
}

function createTrace(runtimeConfig: RuntimeConfig, cwd: string, io: CliIO): ExecutionTrace {
  const traceDir = runtimeConfig.traceDir ? resolve(cwd, runtimeConfig.traceDir) : undefined;
  return createExecutionTrace({
    verbose: runtimeConfig.verbose,
    traceDir,
    showPeerCommand: runtimeConfig.showPeerCommand,
    showPeerOutput: runtimeConfig.showPeerOutput,
    stderr: (line) => log(io, line),
  });
}

function defaultResolveAdapter(name: string, options: AdapterFactoryOptions): Adapter {
  switch (name) {
    case 'codex-cli':
      return new CodexCliAdapter({
        timeout: options.timeout,
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        codexBin: options.codexBin,
        modelSource: options.modelSource,
        trace: options.trace,
      });
    default:
      throw new Error(`Unknown adapter "${name}". Available adapters: codex-cli`);
  }
}

async function runDoctorCommand(
  _args: CliArgs,
  runtimeConfig: RuntimeConfig,
  cwd: string,
  io: CliIO,
  dependencies: RunCliDependencies,
): Promise<number> {
  const doctor = dependencies.runDoctor ?? defaultRunDoctor;
  try {
    const result = await doctor({
      cwd,
      runtimeConfig,
      packageVersion: getPackageVersion(),
    });
    log(io, formatDoctorResult(result));
    return result.ok ? 0 : 1;
  } catch (error) {
    log(io, failLine('Environment check failed', error instanceof Error ? error.message : String(error)));
    return 1;
  }
}

async function runInstallCommand(
  args: CliArgs,
  runtimeConfig: RuntimeConfig,
  cwd: string,
  io: CliIO,
  dependencies: RunCliDependencies,
): Promise<number> {
  const install =
    dependencies.installSkill ??
    (await import('./install.js')).installSkill;
  const doctor = dependencies.runDoctor ?? defaultRunDoctor;

  const c = createColors(detectColorSupport());
  const isTTY = process.stderr.isTTY ?? false;
  const isInteractive = isTTY && args.yes !== true && args['non-interactive'] !== true;
  const shouldReconfigure = args.reconfigure === true;
  const shouldSaveDefaults = args['save-defaults'] === true;

  log(io, '');
  log(io, renderColorHeader('opinionate', getPackageVersion(), c));
  log(io, '');

  // Step 1: Detect environment
  log(io, c.cyan('1. Detecting environment...'));
  const whichFn = (await import('./util/which.js')).which;
  const codexPath = await whichFn(runtimeConfig.codexBin);
  if (codexPath) {
    const { detectCodexCliInfo } = await import('./util/codex-cli-info.js');
    const codexInfo = await detectCodexCliInfo({ codexBin: runtimeConfig.codexBin });
    if (codexInfo.supportsExec) {
      log(io, `   ${c.green('✓')} Codex CLI v${codexInfo.version ?? 'unknown'} (exec supported)`);
    } else {
      log(io, `   ${c.yellow('○')} Codex CLI v${codexInfo.version ?? 'unknown'} (exec not supported)`);
    }
  } else {
    log(io, `   ${c.red('✗')} Codex CLI not found`);
    log(io, `   ${c.dim('→ npm install -g @openai/codex')}`);
  }
  log(io, '');

  // Step 2: Check auth
  log(io, c.cyan('2. Checking Codex auth...'));
  let doctorResult;
  try {
    doctorResult = await doctor({
      cwd,
      runtimeConfig,
      skillInstalled: true, // will be set properly after install
      packageVersion: getPackageVersion(),
    });
  } catch (error) {
    log(io, `   ${c.red('✗')} ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  if (doctorResult.codexAuth?.ok) {
    log(io, `   ${c.green('✓')} Authenticated`);
  } else if (doctorResult.codexAuth) {
    log(io, `   ${c.red('✗')} ${doctorResult.codexAuth.detail ?? 'Auth probe failed'}`);
    log(io, `   ${c.dim('→ codex login')}`);
  } else {
    log(io, `   ${c.yellow('○')} Skipped (Codex not available)`);
  }
  log(io, '');

  // Step 3: Interactive setup (TTY only)
  let launcher: LauncherInfo = await detectLauncher();
  let chosenEffort: string | undefined;
  let userWantsToSave = shouldSaveDefaults;

  if (isInteractive || shouldReconfigure) {
    log(io, c.cyan('3. Setup preferences...'));
    log(io, '');
    try {
      const { runInteractiveSetup } = await import('./util/install-prompts.js');
      const setup = await runInteractiveSetup({
        currentCodexEffort: doctorResult.codexConfig?.reasoningEffort,
      });

      if (!setup.cancelled) {
        launcher = buildLauncherFromMode(setup.installMode);
        chosenEffort = setup.reasoningEffort;
        userWantsToSave = setup.shouldSave;
      }
    } catch {
      // Prompts failed (e.g., stdin closed) — continue with defaults
    }
    log(io, '');
  } else {
    log(io, c.cyan('3. Using defaults...'));
    if (doctorResult.codexConfig?.reasoningEffort?.toLowerCase() === 'xhigh') {
      log(io, `   ${c.yellow('⚠')} Codex reasoning effort is ${c.yellow('xhigh')}`);
      log(io, `   ${c.dim('  Tip: run with --reasoning-effort medium for faster responses')}`);
    }
    log(io, '');
  }

  // Step 4: Install skill
  log(io, c.cyan('4. Installing skill...'));
  let installResult: InstallSkillResult;
  try {
    installResult = await install(cwd);
  } catch (error) {
    installResult = {
      ok: false,
      skillFile: resolve(cwd, '.claude', 'skills', 'opinionate', 'SKILL.md'),
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (installResult.ok) {
    log(io, `   ${c.green('✓')} Skill installed to ${c.dim(installResult.skillFile)}`);
  } else {
    log(io, `   ${c.red('✗')} ${installResult.error ?? 'Installation failed'}`);
  }

  // Save user config if requested
  if (userWantsToSave && chosenEffort) {
    try {
      const config: UserConfig = { version: 1, reasoningEffort: chosenEffort as any };
      saveUserConfig(config);
      log(io, `   ${c.green('✓')} Config saved to ${c.dim('~/.config/opinionate/config.json')}`);
    } catch {
      log(io, `   ${c.yellow('○')} Could not save config (non-critical)`);
    }
  }
  log(io, '');

  // Step 5: Configuration summary
  log(io, c.cyan('5. Configuration...'));
  if (doctorResult.model) {
    log(io, `   ${c.green('✓')} Model: ${doctorResult.model} (${doctorResult.modelSource})`);
  } else {
    log(io, `   ${c.dim('○')} Model: Codex default`);
  }
  if (chosenEffort) {
    log(io, `   ${c.green('✓')} Reasoning effort: ${chosenEffort}${userWantsToSave ? c.dim(' (saved)') : ''}`);
  } else if (doctorResult.codexConfig?.reasoningEffort) {
    const effort = doctorResult.codexConfig.reasoningEffort;
    if (effort.toLowerCase() === 'xhigh') {
      log(io, `   ${c.yellow('⚠')} Reasoning effort: ${c.yellow(effort)}`);
    } else {
      log(io, `   ${c.dim('○')} Reasoning effort: ${effort}`);
    }
  }
  if (doctorResult.linkedBinaryPath) {
    log(io, `   ${c.green('✓')} Binary: ${c.dim(doctorResult.linkedBinaryPath)}`);
  } else if (launcher.mode !== 'npx') {
    log(io, `   ${c.dim('○')} Binary: not in PATH ${c.dim('(use npx opinionate)')}`);
  }
  for (const warning of doctorResult.warnings ?? []) {
    log(io, `   ${c.yellow('⚠')} ${warning}`);
  }
  log(io, '');

  // Summary
  if (doctorResult.ok && installResult.ok) {
    log(io, c.bold(c.green('All checks passed.')));
  } else {
    log(io, c.bold(c.red(`${doctorResult.issues.length} issue${doctorResult.issues.length !== 1 ? 's' : ''} found.`)));
    for (const issue of doctorResult.issues) {
      log(io, `   ${c.red('✗')} ${issue}`);
    }
  }

  if (installResult.ok && doctorResult.ok) {
    log(io, '');
    log(io, c.bold('Next:'));
    log(io, '  1. Restart your Claude Code session in this project');
    log(io, '  2. Type /opinionate to invoke manually, or Claude will auto-trigger it');
    log(io, '');
    log(io, c.bold('Try it now:'));
    log(io, c.dim(`  ${formatRunExample(launcher)}`));
    log(io, '');
    log(io, c.bold('Update later:'));
    log(io, c.dim(`  ${formatUpdateCommand(launcher)}`));
    return 0;
  }

  return 1;
}

async function runDeliberationCommand(
  args: CliArgs,
  runtimeConfig: RuntimeConfig,
  cwd: string,
  io: CliIO,
  dependencies: RunCliDependencies,
  command: 'run' | 'continue',
): Promise<number> {
  await pruneExpiredSessions(cwd).catch(() => undefined);

  const sessionIdArg = typeof args.session === 'string' ? args.session : undefined;
  let existingSession: DeliberationSession | undefined;

  if (command === 'continue') {
    if (!sessionIdArg) {
      log(io, 'Error: --session is required for `opinionate continue`');
      return 1;
    }

    try {
      existingSession = await loadSession(cwd, sessionIdArg);
    } catch (error) {
      log(io, `Error: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }

  const mode = (args.mode as DeliberationMode | undefined) ?? existingSession?.mode;
  const task = (args.task as string | undefined) ?? existingSession?.task;

  if (!mode || !['plan', 'review', 'debug', 'decide'].includes(mode)) {
    log(io, 'Error: --mode is required and must be one of: plan, review, debug, decide');
    return 1;
  }

  if (!task) {
    log(io, 'Error: --task is required');
    return 1;
  }

  const rawMaxRounds = typeof args['max-rounds'] === 'string'
    ? Number.parseInt(args['max-rounds'], 10)
    : DEFAULT_CONFIG.maxRounds;
  const maxRounds = Number.isFinite(rawMaxRounds) && rawMaxRounds > 0
    ? rawMaxRounds
    : DEFAULT_CONFIG.maxRounds;
  let context = buildContext(args, runtimeConfig, cwd, io, task);
  const trace = createTrace(runtimeConfig, cwd, io);

  let sessionId: string | undefined;
  if (command === 'run' && runtimeConfig.persistSession) {
    const created = await createSession({
      cwd,
      mode,
      task,
    });
    sessionId = created.id;
    context = {
      ...context,
      persistSession: true,
      sessionId,
    };
  } else if (existingSession) {
    sessionId = existingSession.id;
    const safeFiles = filterSafeFiles(cwd, context.files, runtimeConfig.contextBudget);
    context = {
      ...context,
      persistSession: true,
      sessionId,
      resumeMemory: existingSession.memory,
      fileDeltas: buildSessionFileDeltas(cwd, existingSession, safeFiles),
    };
  }

  const adapterOptions: AdapterFactoryOptions = {
    timeout: runtimeConfig.timeout,
    model: runtimeConfig.model,
    reasoningEffort: runtimeConfig.reasoningEffort,
    modelSource: runtimeConfig.modelSource,
    codexBin: runtimeConfig.codexBin,
    trace,
  };

  const resolveAdapter = dependencies.resolveAdapter ?? defaultResolveAdapter;
  const peerAdapterName = (args['peer-adapter'] as string) || 'codex-cli';
  const orchestratorAdapterName = args['orchestrator-adapter'] as string | undefined;

  let peerAdapter: Adapter;
  let orchestratorAdapter: Adapter | undefined;
  try {
    peerAdapter = resolveAdapter(peerAdapterName, adapterOptions);
    orchestratorAdapter = orchestratorAdapterName
      ? resolveAdapter(orchestratorAdapterName, adapterOptions)
      : undefined;
  } catch (error) {
    log(io, `Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const reporter = new TerminalReporter({
    stderr: (chunk) => io.stderr(chunk),
    verbose: runtimeConfig.verbose,
    mode,
    maxRounds,
    colorSupport: detectColorSupport(),
  });

  reporter.emitHeader(peerAdapterName, runtimeConfig.model);

  // Context summary
  const inlineCount = context.files?.filter(f => typeof f.content === 'string').length ?? 0;
  const referenceCount = (context.files?.length ?? 0) - inlineCount;
  reporter.emitContextSummary({
    fileCount: context.files?.length,
    inlineCount,
    referenceCount,
    hasGitLog: !!context.gitLog,
    hasResume: !!context.resumeMemory,
    sessionId,
  });

  if (existingSession) {
    reporter.emitSessionResumed(existingSession.id);
  }

  let currentRound = 0;
  const heartbeatRegex = /^Round (\d+): waiting\.\.\. (\d+)s elapsed, (.+?) \/ (.+)$/;
  const deliberation = new Deliberation({
    maxRounds,
    timeout: runtimeConfig.timeout,
    contextBudget: runtimeConfig.contextBudget,
    mode,
    peerAdapter,
    orchestratorAdapter,
    context,
    retryOnTimeout: runtimeConfig.retryOnTimeout,
    onVerbose: (message) => {
      trace.emitVerbose(message);
      // Route heartbeat messages through the reporter for styled output
      const hbMatch = message.match(heartbeatRegex);
      if (hbMatch) {
        const round = Number.parseInt(hbMatch[1]!, 10);
        const elapsed = Number.parseInt(hbMatch[2]!, 10);
        // Only show heartbeat after 30s to avoid noise
        if (elapsed >= 30) {
          const stdoutPart = hbMatch[3]!;
          const stdoutBytes = stdoutPart.includes('KB')
            ? Number.parseFloat(stdoutPart) * 1024
            : 0;
          const stderrBytes = Number.parseFloat(hbMatch[4]!) * 1024;
          reporter.emitRoundWaiting(round, elapsed, stdoutBytes, stderrBytes);
        }
        return;
      }
      reporter.emitDiagnostic(currentRound || 1, message);
    },
    onRoundStart: (round) => {
      currentRound = round;
      reporter.emitRoundStart(round);
    },
    onRoundComplete: (round, _transcript, roundResult) => {
      reporter.emitRoundComplete(
        round,
        roundResult?.durationMs ?? 0,
        roundResult?.agreed ?? false,
      );
    },
  });

  try {
    const result = await deliberation.run();
    reporter.emitResult(result.agreed, result.rounds, reporter.getElapsedMs());
    if (sessionId) {
      result.sessionId = sessionId;
      if (command === 'continue') {
        result.continuedFromSession = true;
      }
      if (command === 'run' && runtimeConfig.persistSession) {
        result.persistedSession = true;
      }
      await persistSessionArtifacts(cwd, sessionId, mode, context, result);
      reporter.emitSessionPersisted(sessionId);
    }
    io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reporter.emitError(message, getErrorRemedy(error));
    return 1;
  }
}

export async function runCli(
  argv: string[],
  dependencies: RunCliDependencies = {},
): Promise<number> {
  const io = dependencies.io ?? createDefaultIO();
  const args = parseArgs(argv);
  const userConfig = loadUserConfig();
  const runtimeConfig = resolveRuntimeConfig({
    argv: args,
    env: dependencies.env ?? process.env,
    userConfig,
  });

  const baseCwd = typeof args.cwd === 'string'
    ? args.cwd
    : dependencies.cwd?.() ?? process.cwd();
  const cwd = resolve(baseCwd);
  const command = args._command as string | undefined;

  switch (command) {
    case 'doctor':
      return runDoctorCommand(args, runtimeConfig, cwd, io, dependencies);
    case 'install':
      return runInstallCommand(args, runtimeConfig, cwd, io, dependencies);
    case 'run':
      return runDeliberationCommand(args, runtimeConfig, cwd, io, dependencies, 'run');
    case 'continue':
      return runDeliberationCommand(args, runtimeConfig, cwd, io, dependencies, 'continue');
    default:
      printUsage(io);
      return 1;
  }
}

async function main(): Promise<void> {
  const exitCode = await runCli(process.argv);
  process.exit(exitCode);
}

const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
