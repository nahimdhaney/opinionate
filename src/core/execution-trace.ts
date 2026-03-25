import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelSource } from './runtime-config.js';
import type { CodexCliInfo } from '../util/codex-cli-info.js';
import { parsePeerStderr } from '../util/peer-stderr-parser.js';

export interface RoundTraceStart {
  round: number;
  attempt?: number;
  command: string[];
  model?: string;
  modelSource: ModelSource;
  reasoningEffort?: string;
  codexInfo?: CodexCliInfo;
  pid?: number;
}

export interface RoundTraceRecord extends RoundTraceStart {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
}

export interface ExecutionTraceOptions {
  verbose: boolean;
  traceDir?: string;
  showPeerCommand?: boolean;
  showPeerOutput?: boolean;
  stderr?: (line: string) => void;
}

export interface ExecutionTrace {
  onRoundStart(meta: RoundTraceStart): void;
  onPeerStdout(round: number, chunk: string, attempt?: number): void;
  onPeerStderr(round: number, chunk: string, attempt?: number): void;
  onRoundFinish(meta: Omit<RoundTraceRecord, 'stdout' | 'stderr'> & { stdout?: string; stderr?: string }): Promise<void>;
  recordRoundResult(record: RoundTraceRecord): Promise<void>;
  emitVerbose(message: string): void;
}

function quoteArg(arg: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(arg)) {
    return arg;
  }
  return JSON.stringify(arg);
}

function formatCommand(command: string[], exact: boolean): string {
  if (exact) {
    return command.map(quoteArg).join(' ');
  }

  if (command.length <= 3) {
    return command.map(quoteArg).join(' ');
  }

  const prompt = command[command.length - 1]!;
  const prefix = command.slice(0, -1).map(quoteArg).join(' ');
  return `${prefix} [prompt omitted; ${prompt.length} chars]`;
}

function emitChunk(
  sink: (line: string) => void,
  prefix: string,
  chunk: string,
): void {
  for (const line of chunk.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    sink(`[opinionate] ${prefix}: ${line}`);
  }
}

function traceKey(round: number, attempt?: number): string {
  return attempt === undefined ? `${round}` : `${round}:${attempt}`;
}

function formatRoundLabel(round: number, attempt?: number): string {
  return attempt !== undefined && attempt > 1 ? `Round ${round} attempt ${attempt}` : `Round ${round}`;
}

function getTraceFilename(record: Pick<RoundTraceRecord, 'round' | 'attempt'>): string {
  return record.attempt === undefined
    ? `round-${record.round}.json`
    : `round-${record.round}-attempt-${record.attempt}.json`;
}

export function createExecutionTrace(options: ExecutionTraceOptions): ExecutionTrace {
  const stderr = options.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));
  const rounds = new Map<string, RoundTraceRecord>();
  const stderrBuffers = new Map<string, string>();

  const ensureRound = (round: number, attempt?: number): RoundTraceRecord => {
    const key = traceKey(round, attempt);
    const existing = rounds.get(key);
    if (existing) {
      return existing;
    }

    const created: RoundTraceRecord = {
      round,
      attempt,
      command: [],
      modelSource: 'codex-default',
      stdout: '',
      stderr: '',
      exitCode: null,
      signal: null,
      durationMs: 0,
    };
    rounds.set(key, created);
    return created;
  };

  return {
    emitVerbose(message) {
      if (!options.verbose) {
        return;
      }
      stderr(`[opinionate] ${message}`);
    },

    onRoundStart(meta) {
      const key = traceKey(meta.round, meta.attempt);
      const record = ensureRound(meta.round, meta.attempt);
      rounds.set(key, { ...record, ...meta });
      const roundLabel = formatRoundLabel(meta.round, meta.attempt);

      if (options.verbose) {
        stderr(`[opinionate] ${roundLabel}: starting Codex peer`);
        stderr(
          `[opinionate] ${roundLabel}: model source: ${meta.modelSource}${meta.model ? ` (${meta.model})` : ''}`,
        );
        if (meta.reasoningEffort) {
          stderr(`[opinionate] ${roundLabel}: reasoning effort override: ${meta.reasoningEffort}`);
        }
        if (meta.codexInfo?.version) {
          stderr(`[opinionate] ${roundLabel}: codex version ${meta.codexInfo.version}`);
        }
        if (meta.pid) {
          stderr(`[opinionate] ${roundLabel}: pid ${meta.pid}`);
        }
      }

      if (options.showPeerCommand) {
        stderr(
          `[opinionate] ${roundLabel}: peer command: ${formatCommand(meta.command, true)}`,
        );
      } else if (options.verbose) {
        stderr(
          `[opinionate] ${roundLabel}: peer command: ${formatCommand(meta.command, false)}`,
        );
      }
    },

    onPeerStdout(round, chunk, attempt) {
      const record = ensureRound(round, attempt);
      record.stdout += chunk;
      if (options.showPeerOutput) {
        emitChunk(stderr, `${formatRoundLabel(round, attempt)} peer stdout`, chunk);
      }
    },

    onPeerStderr(round, chunk, attempt) {
      const key = traceKey(round, attempt);
      const record = ensureRound(round, attempt);
      record.stderr += chunk;
      if (options.verbose) {
        const buffered = `${stderrBuffers.get(key) ?? ''}${chunk}`;
        const lines = buffered.split(/\r?\n/);
        const remainder = lines.pop() ?? '';
        stderrBuffers.set(key, remainder);
        for (const diagnostic of parsePeerStderr(lines.join('\n'))) {
          stderr(`[opinionate] ${formatRoundLabel(round, attempt)}: ${diagnostic.message}`);
        }
      }
      if (options.showPeerOutput) {
        emitChunk(stderr, `${formatRoundLabel(round, attempt)} peer stderr`, chunk);
      }
    },

    async onRoundFinish(meta) {
      const record = ensureRound(meta.round, meta.attempt);
      await this.recordRoundResult({
        ...record,
        ...meta,
        stdout: meta.stdout ?? record.stdout,
        stderr: meta.stderr ?? record.stderr,
      });
    },

    async recordRoundResult(record) {
      const key = traceKey(record.round, record.attempt);
      rounds.set(key, record);
      stderrBuffers.delete(key);
      const roundLabel = formatRoundLabel(record.round, record.attempt);

      if (options.verbose) {
        const exitInfo =
          record.exitCode !== null ? `exit ${record.exitCode}` : `signal ${record.signal ?? 'unknown'}`;
        stderr(
          `[opinionate] ${roundLabel}: finished in ${record.durationMs}ms (${exitInfo})`,
        );
      }

      if (options.traceDir) {
        mkdirSync(options.traceDir, { recursive: true });
        writeFileSync(
          join(options.traceDir, getTraceFilename(record)),
          JSON.stringify(record, null, 2) + '\n',
          'utf8',
        );
      }
    },
  };
}
