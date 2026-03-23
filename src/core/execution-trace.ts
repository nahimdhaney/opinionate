import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelSource } from './runtime-config.js';
import type { CodexCliInfo } from '../util/codex-cli-info.js';
import { parsePeerStderr } from '../util/peer-stderr-parser.js';

export interface RoundTraceStart {
  round: number;
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
  onPeerStdout(round: number, chunk: string): void;
  onPeerStderr(round: number, chunk: string): void;
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

export function createExecutionTrace(options: ExecutionTraceOptions): ExecutionTrace {
  const stderr = options.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));
  const rounds = new Map<number, RoundTraceRecord>();
  const stderrBuffers = new Map<number, string>();

  const ensureRound = (round: number): RoundTraceRecord => {
    const existing = rounds.get(round);
    if (existing) {
      return existing;
    }

    const created: RoundTraceRecord = {
      round,
      command: [],
      modelSource: 'codex-default',
      stdout: '',
      stderr: '',
      exitCode: null,
      signal: null,
      durationMs: 0,
    };
    rounds.set(round, created);
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
      const record = ensureRound(meta.round);
      rounds.set(meta.round, { ...record, ...meta });

      if (options.verbose) {
        stderr(`[opinionate] Round ${meta.round}: starting Codex peer`);
        stderr(
          `[opinionate] Round ${meta.round}: model source: ${meta.modelSource}${meta.model ? ` (${meta.model})` : ''}`,
        );
        if (meta.reasoningEffort) {
          stderr(`[opinionate] Round ${meta.round}: reasoning effort override: ${meta.reasoningEffort}`);
        }
        if (meta.codexInfo?.version) {
          stderr(`[opinionate] Round ${meta.round}: codex version ${meta.codexInfo.version}`);
        }
        if (meta.pid) {
          stderr(`[opinionate] Round ${meta.round}: pid ${meta.pid}`);
        }
      }

      if (options.showPeerCommand) {
        stderr(
          `[opinionate] Round ${meta.round}: peer command: ${formatCommand(meta.command, true)}`,
        );
      } else if (options.verbose) {
        stderr(
          `[opinionate] Round ${meta.round}: peer command: ${formatCommand(meta.command, false)}`,
        );
      }
    },

    onPeerStdout(round, chunk) {
      const record = ensureRound(round);
      record.stdout += chunk;
      if (options.showPeerOutput) {
        emitChunk(stderr, `Round ${round} peer stdout`, chunk);
      }
    },

    onPeerStderr(round, chunk) {
      const record = ensureRound(round);
      record.stderr += chunk;
      if (options.verbose) {
        const buffered = `${stderrBuffers.get(round) ?? ''}${chunk}`;
        const lines = buffered.split(/\r?\n/);
        const remainder = lines.pop() ?? '';
        stderrBuffers.set(round, remainder);
        for (const diagnostic of parsePeerStderr(lines.join('\n'))) {
          stderr(`[opinionate] Round ${round}: ${diagnostic.message}`);
        }
      }
      if (options.showPeerOutput) {
        emitChunk(stderr, `Round ${round} peer stderr`, chunk);
      }
    },

    async onRoundFinish(meta) {
      const record = ensureRound(meta.round);
      await this.recordRoundResult({
        ...record,
        ...meta,
        stdout: meta.stdout ?? record.stdout,
        stderr: meta.stderr ?? record.stderr,
      });
    },

    async recordRoundResult(record) {
      rounds.set(record.round, record);
      stderrBuffers.delete(record.round);

      if (options.verbose) {
        const exitInfo =
          record.exitCode !== null ? `exit ${record.exitCode}` : `signal ${record.signal ?? 'unknown'}`;
        stderr(
          `[opinionate] Round ${record.round}: finished in ${record.durationMs}ms (${exitInfo})`,
        );
      }

      if (options.traceDir) {
        mkdirSync(options.traceDir, { recursive: true });
        writeFileSync(
          join(options.traceDir, `round-${record.round}.json`),
          JSON.stringify(record, null, 2) + '\n',
          'utf8',
        );
      }
    },
  };
}
