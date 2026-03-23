import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import { which } from '../util/which.js';
import {
  buildCodexExecArgs,
  detectCodexCliInfo,
  type CodexCliInfo,
} from '../util/codex-cli-info.js';
import type { ExecutionTrace } from '../core/execution-trace.js';
import type { ModelSource, ReasoningEffort } from '../core/runtime-config.js';
import type { Adapter, AdapterCallOptions, AdapterResponse, DeliberationContext } from '../core/types.js';
import { DeliberationError } from '../core/types.js';

type SpawnedProcess = {
  stdout: NodeJS.EventEmitter;
  stderr: NodeJS.EventEmitter;
  pid?: number;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
};

type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => SpawnedProcess;

function defaultSpawnProcess(
  command: string,
  args: string[],
  options: SpawnOptions,
): SpawnedProcess {
  const child = spawn(command, args, options);
  if (!child.stdout || !child.stderr) {
    throw new Error('Codex CLI process did not expose stdout/stderr pipes.');
  }
  return child as unknown as SpawnedProcess;
}

export interface CodexCliOptions {
  timeout?: number;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  codexBin?: string;
  modelSource?: ModelSource;
  trace?: ExecutionTrace;
  which?: typeof which;
  detectCliInfo?: typeof detectCodexCliInfo;
  spawnProcess?: SpawnProcess;
  heartbeatIntervalMs?: number;
}

export class CodexCliAdapter implements Adapter {
  public readonly name = 'codex-cli';

  private readonly timeout: number;
  private readonly model?: string;
  private readonly reasoningEffort?: ReasoningEffort;
  private readonly codexBin: string;
  private readonly modelSource: ModelSource;
  private readonly trace?: ExecutionTrace;
  private readonly whichFn: typeof which;
  private readonly detectCliInfoFn: typeof detectCodexCliInfo;
  private readonly spawnProcess: SpawnProcess;
  private readonly heartbeatIntervalMs: number;

  private activeProcess: SpawnedProcess | null = null;
  private cliInfo: CodexCliInfo | null = null;
  private roundCounter = 0;

  constructor(options: CodexCliOptions = {}) {
    this.timeout = options.timeout ?? 60_000;
    this.model = options.model;
    this.reasoningEffort = options.reasoningEffort;
    this.codexBin = options.codexBin ?? 'codex';
    this.modelSource = options.modelSource ?? 'codex-default';
    this.trace = options.trace;
    this.whichFn = options.which ?? which;
    this.detectCliInfoFn = options.detectCliInfo ?? detectCodexCliInfo;
    this.spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
  }

  async initialize(): Promise<void> {
    const available = await this.isAvailable();
    if (!available) {
      throw new DeliberationError(
        'Codex CLI is not installed. Install it with: npm install -g @openai/codex',
        'ADAPTER_UNAVAILABLE',
      );
    }

    this.cliInfo = await this.detectCliInfoFn({ codexBin: this.codexBin });

    if (!this.cliInfo.supportsExec) {
      throw new DeliberationError(
        'Installed Codex CLI does not support non-interactive exec mode.',
        'ADAPTER_UNAVAILABLE',
      );
    }
  }

  async isAvailable(): Promise<boolean> {
    return (await this.whichFn(this.codexBin)) !== null;
  }

  async sendMessage(
    prompt: string,
    context: DeliberationContext,
    options: AdapterCallOptions = {},
  ): Promise<string | AdapterResponse> {
    const cliInfo = this.cliInfo ?? await this.detectCliInfoFn({ codexBin: this.codexBin });
    this.cliInfo = cliInfo;

    const args = buildCodexExecArgs(prompt, cliInfo, this.model, this.reasoningEffort);
    const round = ++this.roundCounter;
    const timeoutMs = options.timeoutMs ?? this.timeout;

    return new Promise<string | AdapterResponse>((resolve, reject) => {
      const startedAt = Date.now();
      let stdout = '';
      let stderr = '';
      let finished = false;
      let timedOut = false;
      let forceKillTimer: NodeJS.Timeout | undefined;

      const child = this.spawnProcess(this.codexBin, args, {
        cwd: context.cwd ?? process.cwd(),
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.activeProcess = child;

      this.trace?.onRoundStart({
        round,
        command: [this.codexBin, ...args],
        model: this.model,
        modelSource: this.modelSource,
        reasoningEffort: this.reasoningEffort,
        codexInfo: cliInfo,
        pid: child.pid,
      });

      const heartbeat = setInterval(() => {
        this.trace?.emitVerbose(
          `Round ${round}: waiting... ${Math.round((Date.now() - startedAt) / 1000)}s elapsed, ${
            stdout.trim().length > 0
              ? `${(Buffer.byteLength(stdout, 'utf-8') / 1024).toFixed(1)}KB stdout`
              : 'no output yet'
          } / ${(Buffer.byteLength(stderr, 'utf-8') / 1024).toFixed(1)}KB stderr`,
        );
      }, this.heartbeatIntervalMs);

      const fail = (error: DeliberationError) => {
        if (finished) {
          return;
        }
        finished = true;
        this.activeProcess = null;
        clearInterval(heartbeat);
        clearTimeout(timer);
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
        }
        reject(error);
      };

      const timer = setTimeout(() => {
        if (finished || timedOut) {
          return;
        }
        timedOut = true;
        this.trace?.emitVerbose(
          `Round ${round}: timeout reached after ${timeoutMs}ms, waiting up to 5000ms for peer shutdown`,
        );
        child.kill('SIGINT');
        forceKillTimer = setTimeout(() => {
          child.kill('SIGTERM');
        }, 5_000);
      }, timeoutMs);

      child.stdout.on('data', (data: Buffer | string) => {
        const chunk = data.toString();
        stdout += chunk;
        this.trace?.onPeerStdout(round, chunk);
      });

      child.stderr.on('data', (data: Buffer | string) => {
        const chunk = data.toString();
        stderr += chunk;
        this.trace?.onPeerStderr(round, chunk);
      });

      child.on('error', (err) => {
        clearInterval(heartbeat);
        clearTimeout(timer);
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
        }
        void this.trace?.onRoundFinish({
          round,
          command: [this.codexBin, ...args],
          model: this.model,
          modelSource: this.modelSource,
          reasoningEffort: this.reasoningEffort,
          stdout,
          stderr,
          exitCode: null,
          signal: null,
          durationMs: Date.now() - startedAt,
        });
        fail(
          new DeliberationError(
            `Failed to spawn Codex CLI: ${err.message}`,
            'ADAPTER_ERROR',
          ),
        );
      });

      child.on('close', (code, signal) => {
        clearInterval(heartbeat);
        clearTimeout(timer);
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
        }
        void this.trace?.onRoundFinish({
          round,
          command: [this.codexBin, ...args],
          model: this.model,
          modelSource: this.modelSource,
          reasoningEffort: this.reasoningEffort,
          stdout,
          stderr,
          exitCode: code,
          signal,
          durationMs: Date.now() - startedAt,
        });

        if (finished) {
          return;
        }

        this.activeProcess = null;
        finished = true;

        if (timedOut) {
          const response = stdout.trim();
          if (response.length > 200) {
            // Enough content to be useful — return as partial
            resolve({
              content: response,
              partial: true,
              signal,
              durationMs: Date.now() - startedAt,
            });
            return;
          }

          reject(
            new DeliberationError(
              `Codex CLI timed out after ${timeoutMs}ms`,
              'ADAPTER_TIMEOUT',
              round,
            ),
          );
          return;
        }

        if (code !== 0) {
          reject(
            new DeliberationError(
              `Codex CLI exited with code ${code}: ${stderr.trim() || stdout.trim() || 'no output'}`,
              'ADAPTER_ERROR',
            ),
          );
          return;
        }

        const response = stdout.trim();
        if (!response) {
          reject(
            new DeliberationError(
              `Codex CLI returned empty response. stderr: ${stderr.trim()}`,
              'ADAPTER_ERROR',
            ),
          );
          return;
        }

        resolve(response);
      });
    });
  }

  async cleanup(): Promise<void> {
    if (this.activeProcess) {
      const proc = this.activeProcess;
      this.activeProcess = null;
      proc.kill('SIGINT');
      const forceTimer = setTimeout(() => {
        proc.kill('SIGTERM');
      }, 5_000);
      proc.on('close', () => clearTimeout(forceTimer));
    }
  }
}
