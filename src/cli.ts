#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Deliberation } from './core/deliberation.js';
import { createExecutionTrace } from './core/execution-trace.js';
import { formatDoctorResult, runDoctor as defaultRunDoctor } from './core/preflight.js';
import { resolveRuntimeConfig } from './core/runtime-config.js';
import type { ExecutionTrace } from './core/execution-trace.js';
import type { ModelSource, RuntimeConfig } from './core/runtime-config.js';
import type { DeliberationContext, DeliberationMode, FileContext, Adapter } from './core/types.js';
import { DEFAULT_CONFIG } from './core/types.js';
import { CodexCliAdapter } from './adapters/codex-cli.js';

type CliArgs = Record<string, string | boolean | undefined>;

interface CliIO {
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
}

export interface AdapterFactoryOptions {
  timeout: number;
  model?: string;
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
  installSkill?: (targetDir?: string) => Promise<void>;
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
  log(io, '       opinionate doctor [options]');
  log(io, '       opinionate install');
  log(io, '');
  log(io, 'Commands:');
  log(io, '  run      Run a deliberation session');
  log(io, '  doctor   Check Codex, model, skill, and binary readiness');
  log(io, '  install  Install the Claude Code skill into .claude/skills');
  log(io, '');
  log(io, 'Options for run/doctor:');
  log(io, '  --cwd <path>                        Working directory (default: current directory)');
  log(io, '  --timeout <ms>                      Per-round timeout in ms (default: 60000)');
  log(io, '  --context-budget <bytes>            Max context size (default: 50000)');
  log(io, '  --model <name>                      Model override for Codex peer');
  log(io, '  --codex-bin <path>                  Codex binary path (default: codex)');
  log(io, '  --verbose                           Print peer execution details to stderr');
  log(io, '  --trace-dir <path>                  Persist per-round JSON trace artifacts');
  log(io, '  --show-peer-command                 Print the exact Codex command line');
  log(io, '  --show-peer-output                  Stream peer stdout/stderr to stderr');
  log(io, '');
  log(io, 'Options for run:');
  log(io, '  --mode <plan|review|debug|decide>   Deliberation mode (required)');
  log(io, '  --task <description>                Task to deliberate on (required)');
  log(io, '  --files <path1,path2,...>           Comma-separated file paths');
  log(io, '  --git-log                           Include recent git history');
  log(io, '  --conversation-summary <text>       Current conversation context');
  log(io, '  --max-rounds <n>                    Max deliberation rounds (default: 5)');
  log(io, '  --peer-adapter <name>               Peer adapter (default: codex-cli)');
  log(io, '  --orchestrator-adapter <name>       Orchestrator adapter');
}

function loadFiles(filePaths: string, cwd: string, io: CliIO): FileContext[] {
  const paths = filePaths.split(',').map((path) => path.trim()).filter(Boolean);
  const files: FileContext[] = [];

  for (const path of paths) {
    const fullPath = resolve(cwd, path);
    if (!existsSync(fullPath)) {
      log(io, `Warning: File not found: ${path}`);
      continue;
    }

    try {
      files.push({ path, content: readFileSync(fullPath, 'utf8') });
    } catch {
      log(io, `Warning: Could not read file ${path}`);
    }
  }

  return files;
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

function buildContext(args: CliArgs, cwd: string, io: CliIO): DeliberationContext {
  const task = args.task as string;
  const context: DeliberationContext = { task, cwd };

  if (typeof args.files === 'string') {
    context.files = loadFiles(args.files, cwd, io);
  }

  if (args['git-log']) {
    context.gitLog = getGitLog(cwd);
  }

  if (typeof args['conversation-summary'] === 'string') {
    context.conversationSummary = args['conversation-summary'];
  }

  return context;
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
        codexBin: options.codexBin,
        modelSource: options.modelSource,
        trace: options.trace,
      });
    default:
      throw new Error(`Unknown adapter "${name}". Available adapters: codex-cli`);
  }
}

async function runDoctorCommand(
  args: CliArgs,
  runtimeConfig: RuntimeConfig,
  cwd: string,
  io: CliIO,
  dependencies: RunCliDependencies,
): Promise<number> {
  const doctor = dependencies.runDoctor ?? defaultRunDoctor;
  const result = await doctor({
    cwd,
    runtimeConfig,
  });
  log(io, formatDoctorResult(result));
  return result.ok ? 0 : 1;
}

async function runInstallCommand(cwd: string, dependencies: RunCliDependencies): Promise<number> {
  if (dependencies.installSkill) {
    await dependencies.installSkill(cwd);
    return 0;
  }

  const { installSkill } = await import('./install.js');
  await installSkill(cwd);
  return 0;
}

async function runDeliberationCommand(
  args: CliArgs,
  runtimeConfig: RuntimeConfig,
  cwd: string,
  io: CliIO,
  dependencies: RunCliDependencies,
): Promise<number> {
  const mode = args.mode as DeliberationMode | undefined;
  const task = args.task as string | undefined;

  if (!mode || !['plan', 'review', 'debug', 'decide'].includes(mode)) {
    log(io, 'Error: --mode is required and must be one of: plan, review, debug, decide');
    return 1;
  }

  if (!task) {
    log(io, 'Error: --task is required');
    return 1;
  }

  const maxRounds = typeof args['max-rounds'] === 'string'
    ? Number.parseInt(args['max-rounds'], 10)
    : DEFAULT_CONFIG.maxRounds;
  const context = buildContext(args, cwd, io);
  const trace = createTrace(runtimeConfig, cwd, io);

  const adapterOptions: AdapterFactoryOptions = {
    timeout: runtimeConfig.timeout,
    model: runtimeConfig.model,
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

  log(io, `Starting deliberation: mode=${mode}, maxRounds=${maxRounds}, peer=${peerAdapterName}`);
  if (orchestratorAdapterName) {
    log(io, `Orchestrator adapter: ${orchestratorAdapterName}`);
  }

  const deliberation = new Deliberation({
    maxRounds,
    timeout: runtimeConfig.timeout,
    contextBudget: runtimeConfig.contextBudget,
    mode,
    peerAdapter,
    orchestratorAdapter,
    context,
    onRoundComplete: (round) => {
      log(io, `Deliberating... Round ${round}/${maxRounds} complete.`);
    },
  });

  try {
    const result = await deliberation.run();
    io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    log(io, `Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

export async function runCli(
  argv: string[],
  dependencies: RunCliDependencies = {},
): Promise<number> {
  const io = dependencies.io ?? createDefaultIO();
  const args = parseArgs(argv);
  const runtimeConfig = resolveRuntimeConfig({
    argv: args,
    env: dependencies.env ?? process.env,
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
      return runInstallCommand(cwd, dependencies);
    case 'run':
      return runDeliberationCommand(args, runtimeConfig, cwd, io, dependencies);
    default:
      printUsage(io);
      return 1;
  }
}

async function main(): Promise<void> {
  const exitCode = await runCli(process.argv);
  process.exit(exitCode);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
