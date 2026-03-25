import { existsSync, readFileSync } from 'node:fs';
import type { RuntimeConfig, ModelSource } from './runtime-config.js';
import {
  detectCodexCliInfo,
  probeCodexAuth,
  type CodexAuthStatus,
  type CodexCliInfo,
} from '../util/codex-cli-info.js';
import { readCodexConfig, type CodexConfigSnapshot } from '../util/codex-config.js';
import { parsePeerStderr } from '../util/peer-stderr-parser.js';
import { getClaudeProjectSkillFile } from '../util/claude-skill-paths.js';
import { checkLine, failLine, infoLine } from '../util/format.js';
import { which } from '../util/which.js';
import { parseSkillVersion } from '../install.js';

export interface DoctorResult {
  ok: boolean;
  cwd: string;
  codex: CodexCliInfo | null;
  codexAuth?: CodexAuthStatus;
  skillInstalled: boolean;
  skillVersion?: string | null;
  skillFile: string;
  linkedBinaryPath?: string | null;
  model?: string;
  modelSource: ModelSource;
  codexConfig?: CodexConfigSnapshot;
  issues: string[];
  suggestions: string[];
  warnings?: string[];
}

export interface RunDoctorInput {
  cwd: string;
  runtimeConfig: RuntimeConfig;
  codexInfo?: CodexCliInfo | null;
  codexAuth?: CodexAuthStatus;
  skillInstalled?: boolean;
  linkedBinaryPath?: string | null;
  whichFn?: typeof which;
  detectCliInfo?: typeof detectCodexCliInfo;
  probeAuth?: typeof probeCodexAuth;
  readConfig?: typeof readCodexConfig;
  fileExists?: (path: string) => boolean;
  readSkillFile?: (path: string, encoding: string) => string;
  packageVersion?: string;
}

export async function runDoctor(input: RunDoctorInput): Promise<DoctorResult> {
  const whichFn = input.whichFn ?? which;
  const detectCliInfo = input.detectCliInfo ?? detectCodexCliInfo;
  const probeAuth = input.probeAuth ?? probeCodexAuth;
  const readConfig = input.readConfig ?? readCodexConfig;
  const fileExists = input.fileExists ?? existsSync;

  const skillFile = getClaudeProjectSkillFile(input.cwd);
  const skillInstalled = input.skillInstalled ?? fileExists(skillFile);
  const linkedBinaryPath =
    input.linkedBinaryPath !== undefined
      ? input.linkedBinaryPath
      : await whichFn('opinionate');
  const codexConfig = readConfig();

  let codex = input.codexInfo;
  if (codex === undefined) {
    const codexPath = await whichFn(input.runtimeConfig.codexBin);
    codex = codexPath
      ? await detectCliInfo({ codexBin: input.runtimeConfig.codexBin })
      : null;
  }

  let codexAuth = input.codexAuth;
  if (codexAuth === undefined && codex?.supportsExec) {
    codexAuth = await probeAuth({
      codexBin: input.runtimeConfig.codexBin,
      cwd: input.cwd,
      model: input.runtimeConfig.model,
      reasoningEffort: input.runtimeConfig.reasoningEffort,
      codexInfo: codex,
    });
  }

  const issues: string[] = [];
  const suggestions: string[] = [];
  const warnings: string[] = [];

  if (!codex) {
    issues.push('Codex CLI not found. Install it with `npm install -g @openai/codex`.');
  } else if (!codex.supportsExec) {
    issues.push(
      `Codex CLI ${codex.version ?? 'unknown'} does not support non-interactive exec mode. Update Codex before using opinionate.`,
    );
  } else if (input.runtimeConfig.model && !codex.supportsModelFlag && !codex.supportsConfigFlag) {
    issues.push('This Codex CLI build cannot apply a model override for exec runs.');
  }

  if (codexAuth && !codexAuth.ok) {
    if (codexAuth.reason === 'not_authenticated') {
      issues.push('Codex is installed but not authenticated. Run `codex login` and retry.');
    } else if (codexAuth.reason === 'timed_out') {
      issues.push(
        `Codex is installed but slow to start. The exec probe timed out before Codex responded. ${codexAuth.detail ?? ''}`.trim(),
      );
      suggestions.push(
        'Slow startup is often caused by MCP initialization or heavy Codex defaults. Try `--reasoning-effort medium` and temporarily disable slow MCP servers before rerunning `opinionate doctor`.',
      );
    } else if (codexAuth.reason === 'model_unavailable') {
      issues.push(
        `The configured model is not available to the current Codex account. ${codexAuth.detail ?? ''}`.trim(),
      );
    } else {
      issues.push(`Codex exec probe failed. ${codexAuth.detail ?? ''}`.trim());
    }
  }

  if (codexAuth?.stderr) {
    for (const diagnostic of parsePeerStderr(codexAuth.stderr)) {
      if (diagnostic.severity === 'warning') {
        warnings.push(diagnostic.message);
      }
    }
  }

  if (codexConfig?.reasoningEffort?.toLowerCase() === 'xhigh') {
    warnings.push(
      `Codex reasoning effort is configured as xhigh in ${codexConfig.path} (consider --reasoning-effort medium for faster peer responses).`,
    );
  }

  let skillVersion: string | null = null;
  if (skillInstalled) {
    try {
      const content = (input.readSkillFile ?? readFileSync)(skillFile, 'utf8') as string;
      skillVersion = parseSkillVersion(content);
    } catch { /* ignore read errors */ }
  }

  if (!skillInstalled) {
    issues.push(
      `Claude project skill missing at ${skillFile}. Run \`opinionate install\` from the project root.`,
    );
  } else if (skillVersion && input.packageVersion && skillVersion !== input.packageVersion) {
    warnings.push(
      `Skill version (${skillVersion}) does not match package version (${input.packageVersion}). Run \`opinionate install\` to update.`,
    );
  }

  if (input.runtimeConfig.modelSource === 'cli') {
    suggestions.push(`Run will use explicit override model "${input.runtimeConfig.model}".`);
  } else if (input.runtimeConfig.modelSource === 'env') {
    suggestions.push(`Run will use environment override model "${input.runtimeConfig.model}".`);
  } else {
    suggestions.push('Run will use the Codex default model from your Codex configuration.');
  }

  if (!linkedBinaryPath) {
    suggestions.push('No global `opinionate` binary found. Use `npx opinionate` or `npm link` if needed.');
  }

  return {
    ok: issues.length === 0,
    cwd: input.cwd,
    codex,
    codexAuth,
    skillInstalled,
    skillVersion,
    skillFile,
    linkedBinaryPath,
    model: input.runtimeConfig.model,
    modelSource: input.runtimeConfig.modelSource,
    codexConfig,
    issues,
    suggestions,
    warnings,
  };
}

export function formatDoctorResult(result: DoctorResult): string {
  const lines: string[] = [];
  const codexVersion = result.codex?.version ?? 'unknown';

  if (!result.codex) {
    lines.push(
      failLine(
        'Codex CLI: not installed',
        'Install it with `npm install -g @openai/codex` and rerun `opinionate doctor`',
      ),
    );
  } else if (!result.codex.supportsExec) {
    lines.push(
      failLine(
        `Codex CLI: v${codexVersion} (exec unsupported)`,
        'Update Codex CLI to a build that supports `codex exec`',
      ),
    );
  } else {
    lines.push(checkLine(`Codex CLI: v${codexVersion} (exec supported)`));
  }

  if (result.codex?.supportsExec) {
    if (result.codexAuth?.ok === false && result.codexAuth.reason === 'not_authenticated') {
      lines.push(
        failLine(
          'Codex auth: not authenticated',
          'Run `codex login` and rerun `opinionate doctor`',
        ),
      );
    } else if (result.codexAuth?.ok === false && result.codexAuth.reason === 'model_unavailable') {
      lines.push(
        failLine(
          'Codex auth: authenticated but model unavailable',
          'Choose a supported model or remove the override',
        ),
      );
    } else if (result.codexAuth?.ok === false && result.codexAuth.reason === 'timed_out') {
      lines.push(
        failLine(
          'Codex exec probe: timed out',
          'Codex may be slow to start because of MCP initialization or heavy defaults; try `--reasoning-effort medium` and rerun',
        ),
      );
    } else if (result.codexAuth?.ok === false && result.codexAuth.reason === 'exec_failed') {
      lines.push(
        failLine(
          'Codex exec probe: failed',
          result.codexAuth.detail ?? 'Retry `opinionate doctor` after validating `codex exec` manually',
        ),
      );
    } else {
      lines.push(checkLine('Codex auth: authenticated'));
    }
  }

  if (result.model) {
    if (result.codexAuth?.ok === false && result.codexAuth.reason === 'model_unavailable') {
      lines.push(
        failLine(
          `Model override: ${result.model} is unavailable to this Codex account`,
          'Choose a supported model or remove the override before rerunning',
        ),
      );
    } else if (result.codex && !result.codex.supportsModelFlag && !result.codex.supportsConfigFlag) {
      lines.push(
        failLine(
          `Model override: ${result.model} cannot be applied by this Codex CLI build`,
          'Update Codex CLI or remove the override',
        ),
      );
    } else {
      const source =
        result.modelSource === 'cli'
          ? 'CLI override'
          : result.modelSource === 'env'
            ? 'environment override'
            : 'override';
      lines.push(checkLine(`Model: ${result.model} (${source})`));
    }
  } else {
    lines.push(infoLine('Model: will use Codex default (no override set)'));
  }

  if (result.codexConfig?.reasoningEffort) {
    lines.push(
      infoLine(`Codex reasoning effort: ${result.codexConfig.reasoningEffort} (from ${result.codexConfig.path})`),
    );
  }

  if (result.skillInstalled) {
    const versionInfo = result.skillVersion ? ` (v${result.skillVersion})` : '';
    lines.push(checkLine(`Skill: installed${versionInfo} at ${result.skillFile}`));
  } else {
    lines.push(
      failLine(
        `Skill: missing at ${result.skillFile}`,
        'Run `opinionate install` from the project root',
      ),
    );
  }

  if (result.linkedBinaryPath) {
    lines.push(checkLine(`opinionate binary: ${result.linkedBinaryPath}`));
  } else {
    lines.push(infoLine('opinionate binary: not found in PATH (use `npx opinionate` or `npm link`)'));
  }

  for (const warning of result.warnings ?? []) {
    lines.push(infoLine(`Warning: ${warning}`));
  }

  lines.push('');
  lines.push(
    result.ok
      ? 'All checks passed. You\'re ready to go.'
      : `${result.issues.length} issue${result.issues.length === 1 ? '' : 's'} found. Fix the above before your first deliberation.`,
  );
  return lines.join('\n');
}
