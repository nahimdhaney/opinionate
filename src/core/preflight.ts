import { existsSync } from 'node:fs';
import type { RuntimeConfig, ModelSource } from './runtime-config.js';
import {
  detectCodexCliInfo,
  probeCodexAuth,
  type CodexAuthStatus,
  type CodexCliInfo,
} from '../util/codex-cli-info.js';
import { getClaudeProjectSkillFile } from '../util/claude-skill-paths.js';
import { which } from '../util/which.js';

export interface DoctorResult {
  ok: boolean;
  cwd: string;
  codex: CodexCliInfo | null;
  codexAuth?: CodexAuthStatus;
  skillInstalled: boolean;
  skillFile: string;
  linkedBinaryPath?: string | null;
  model?: string;
  modelSource: ModelSource;
  issues: string[];
  suggestions: string[];
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
  fileExists?: (path: string) => boolean;
}

export async function runDoctor(input: RunDoctorInput): Promise<DoctorResult> {
  const whichFn = input.whichFn ?? which;
  const detectCliInfo = input.detectCliInfo ?? detectCodexCliInfo;
  const probeAuth = input.probeAuth ?? probeCodexAuth;
  const fileExists = input.fileExists ?? existsSync;

  const skillFile = getClaudeProjectSkillFile(input.cwd);
  const skillInstalled = input.skillInstalled ?? fileExists(skillFile);
  const linkedBinaryPath =
    input.linkedBinaryPath !== undefined
      ? input.linkedBinaryPath
      : await whichFn('opinionate');

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
      codexInfo: codex,
    });
  }

  const issues: string[] = [];
  const suggestions: string[] = [];

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
    } else if (codexAuth.reason === 'model_unavailable') {
      issues.push(
        `The configured model is not available to the current Codex account. ${codexAuth.detail ?? ''}`.trim(),
      );
    } else {
      issues.push(`Codex exec probe failed. ${codexAuth.detail ?? ''}`.trim());
    }
  }

  if (!skillInstalled) {
    issues.push(
      `Claude project skill missing at ${skillFile}. Run \`opinionate install\` from the project root.`,
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
    skillFile,
    linkedBinaryPath,
    model: input.runtimeConfig.model,
    modelSource: input.runtimeConfig.modelSource,
    issues,
    suggestions,
  };
}

export function formatDoctorResult(result: DoctorResult): string {
  const lines: string[] = [];
  lines.push(result.ok ? 'Environment ready' : 'Environment has issues');
  lines.push(`Project: ${result.cwd}`);
  lines.push(`Skill: ${result.skillInstalled ? `installed at ${result.skillFile}` : `missing at ${result.skillFile}`}`);
  lines.push(
    result.codex
      ? `Codex: ${result.codex.version ?? 'unknown version'} (exec ${result.codex.supportsExec ? 'yes' : 'no'})`
      : 'Codex: not installed',
  );
  lines.push(
    result.model
      ? `Model: ${result.model} (${result.modelSource})`
      : `Model: Codex default (${result.modelSource})`,
  );

  if (result.linkedBinaryPath) {
    lines.push(`Binary: ${result.linkedBinaryPath}`);
  }

  if (result.issues.length > 0) {
    lines.push('');
    lines.push('Issues:');
    for (const issue of result.issues) {
      lines.push(`- ${issue}`);
    }
  }

  if (result.suggestions.length > 0) {
    lines.push('');
    lines.push('Suggestions:');
    for (const suggestion of result.suggestions) {
      lines.push(`- ${suggestion}`);
    }
  }

  return lines.join('\n');
}
