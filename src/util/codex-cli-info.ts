import { execFile } from 'node:child_process';

export interface CodexCliInfo {
  version: string | null;
  supportsExec: boolean;
  supportsModelFlag: boolean;
  supportsConfigFlag: boolean;
  rawVersion: string | null;
}

export interface RunTextOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
}

export type RunText = (
  command: string,
  args: string[],
  options?: RunTextOptions,
) => Promise<string>;

export interface DetectCodexCliInfoInput {
  codexBin: string;
  runText?: RunText;
}

export interface ProbeCodexAuthInput {
  codexBin: string;
  codexInfo: CodexCliInfo;
  cwd?: string;
  model?: string;
  runText?: RunText;
  timeoutMs?: number;
}

export interface CodexAuthStatus {
  ok: boolean;
  reason?: 'not_authenticated' | 'model_unavailable' | 'exec_failed';
  detail?: string;
}

export const defaultRunText: RunText = (command, args, options = {}) =>
  new Promise<string>((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeoutMs,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const parts = [
            error.message,
            stdout?.trim() ? `stdout: ${stdout.trim()}` : '',
            stderr?.trim() ? `stderr: ${stderr.trim()}` : '',
          ].filter(Boolean);
          reject(new Error(parts.join('\n')));
          return;
        }

        resolve((stdout ?? '').trim());
      },
    );
  });

export function parseCodexVersion(rawVersion: string | null): string | null {
  if (!rawVersion) {
    return null;
  }

  const match = rawVersion.match(/codex-cli\s+([0-9]+(?:\.[0-9]+){0,2})/i);
  return match?.[1] ?? null;
}

export function buildCodexExecArgs(
  prompt: string,
  info: Pick<CodexCliInfo, 'supportsExec' | 'supportsModelFlag' | 'supportsConfigFlag'>,
  model?: string,
): string[] {
  if (!info.supportsExec) {
    throw new Error('Installed Codex CLI does not support non-interactive exec mode.');
  }

  const args = ['exec'];
  if (model) {
    if (info.supportsModelFlag) {
      args.push('-m', model);
    } else if (info.supportsConfigFlag) {
      args.push('-c', `model="${model}"`);
    } else {
      throw new Error('Installed Codex CLI cannot apply a model override for exec runs.');
    }
  }
  args.push(prompt);
  return args;
}

export async function detectCodexCliInfo(input: DetectCodexCliInfoInput): Promise<CodexCliInfo> {
  const runText = input.runText ?? defaultRunText;

  let rawVersion: string | null = null;
  try {
    rawVersion = await runText(input.codexBin, ['--version']);
  } catch {
    rawVersion = null;
  }

  let execHelp = '';
  try {
    execHelp = await runText(input.codexBin, ['exec', '--help']);
  } catch {
    execHelp = '';
  }

  return {
    version: parseCodexVersion(rawVersion),
    rawVersion,
    supportsExec: execHelp.includes('Usage: codex exec'),
    supportsModelFlag: /\s-m[,\s]/.test(execHelp) || execHelp.includes('--model'),
    supportsConfigFlag: /\s-c[,\s]/.test(execHelp) || execHelp.includes('--config'),
  };
}

export async function probeCodexAuth(input: ProbeCodexAuthInput): Promise<CodexAuthStatus> {
  const runText = input.runText ?? defaultRunText;

  try {
    const args = buildCodexExecArgs(
      'Return the word ok and nothing else.',
      input.codexInfo,
      input.model,
    );
    await runText(input.codexBin, args, {
      cwd: input.cwd,
      timeoutMs: input.timeoutMs ?? 10_000,
    });
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/codex login|authenticate|authentication|api key|not logged in|login required/i.test(detail)) {
      return { ok: false, reason: 'not_authenticated', detail };
    }
    if (
      /model.+not supported|model.+not available|requested model|do not have access|unsupported model|change the model/i.test(
        detail,
      )
    ) {
      return { ok: false, reason: 'model_unavailable', detail };
    }
    return { ok: false, reason: 'exec_failed', detail };
  }
}
