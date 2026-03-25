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

export interface RunCaptureResult {
  stdout: string;
  stderr: string;
}

export type RunText = (
  command: string,
  args: string[],
  options?: RunTextOptions,
) => Promise<string>;

export type RunCapture = (
  command: string,
  args: string[],
  options?: RunTextOptions,
) => Promise<RunCaptureResult>;

export interface DetectCodexCliInfoInput {
  codexBin: string;
  runText?: RunText;
}

export interface ProbeCodexAuthInput {
  codexBin: string;
  codexInfo: CodexCliInfo;
  cwd?: string;
  model?: string;
  reasoningEffort?: string;
  runText?: RunText;
  runCapture?: RunCapture;
  timeoutMs?: number;
}

export interface CodexAuthStatus {
  ok: boolean;
  reason?: 'not_authenticated' | 'model_unavailable' | 'timed_out' | 'exec_failed';
  detail?: string;
  stdout?: string;
  stderr?: string;
}

export const defaultRunCapture: RunCapture = (command, args, options = {}) =>
  new Promise<RunCaptureResult>((resolve, reject) => {
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
          const timeoutDetail =
            options.timeoutMs !== undefined &&
            ((error as NodeJS.ErrnoException & { killed?: boolean; signal?: string }).killed ||
              /timed out|ETIMEDOUT/i.test(error.message))
              ? `process timed out after ${options.timeoutMs}ms`
              : null;
          const parts = [
            timeoutDetail ?? error.message,
            stdout?.trim() ? `stdout: ${stdout.trim()}` : '',
            stderr?.trim() ? `stderr: ${stderr.trim()}` : '',
          ].filter(Boolean);
          reject(new Error(parts.join('\n')));
          return;
        }

        resolve({
          stdout: (stdout ?? '').trim(),
          stderr: (stderr ?? '').trim(),
        });
      },
    );
  });

export const defaultRunText: RunText = async (command, args, options = {}) =>
  (await defaultRunCapture(command, args, options)).stdout;

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
  reasoningEffort?: string,
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
  if (reasoningEffort && info.supportsConfigFlag) {
    args.push('-c', `model_reasoning_effort="${reasoningEffort}"`);
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
  const runCapture =
    input.runCapture ??
    (input.runText
      ? async (command: string, args: string[], options?: RunTextOptions) => ({
          stdout: await input.runText!(command, args, options),
          stderr: '',
        })
      : defaultRunCapture);

  try {
    const args = buildCodexExecArgs(
      'Return the word ok and nothing else.',
      input.codexInfo,
      input.model,
      input.reasoningEffort,
    );
    const result = await runCapture(input.codexBin, args, {
      cwd: input.cwd,
      timeoutMs: input.timeoutMs ?? 20_000,
    });
    return {
      ok: true,
      stdout: result.stdout,
      stderr: result.stderr,
    };
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
    if (/timed out|ETIMEDOUT|MCP startup|waiting for MCP/i.test(detail)) {
      return { ok: false, reason: 'timed_out', detail };
    }
    return { ok: false, reason: 'exec_failed', detail };
  }
}
