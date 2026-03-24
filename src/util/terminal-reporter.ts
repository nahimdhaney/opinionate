import { type Colors, type ColorSupport, createColors, detectColorSupport, renderBox } from './format.js';

export interface TerminalReporterOptions {
  stderr: (chunk: string) => void;
  verbose: boolean;
  mode: string;
  maxRounds: number;
  colorSupport?: ColorSupport;
}

export class TerminalReporter {
  private readonly stderr: (chunk: string) => void;
  private readonly verbose: boolean;
  private readonly mode: string;
  private readonly maxRounds: number;
  private readonly c: Colors;
  private startedAt = Date.now();
  private lastRound = 0;

  constructor(options: TerminalReporterOptions) {
    this.stderr = options.stderr;
    this.verbose = options.verbose;
    this.mode = options.mode;
    this.maxRounds = options.maxRounds;
    this.c = createColors(options.colorSupport ?? detectColorSupport());
  }

  emitHeader(peerAdapter: string, model?: string): void {
    const parts = [
      `opinionate`,
      this.mode,
      `${this.maxRounds} round${this.maxRounds !== 1 ? 's' : ''} max`,
    ];
    if (model) {
      parts.push(model);
    }
    parts.push(`peer: ${peerAdapter}`);
    this.emit(renderBox(parts.join(' · ')));
    this.emit('');
    this.startedAt = Date.now();
  }

  emitContextSummary(options: {
    fileCount?: number;
    inlineCount?: number;
    referenceCount?: number;
    hasGitLog?: boolean;
    hasResume?: boolean;
    sessionId?: string;
    payloadSizeKB?: number;
  }): void {
    const parts: string[] = [];
    if (options.fileCount) {
      const detail = options.inlineCount !== undefined && options.referenceCount !== undefined
        ? ` (${options.inlineCount} inline, ${options.referenceCount} by path)`
        : '';
      parts.push(`${this.c.dim('  Files:')} ${options.fileCount}${detail}`);
    }
    if (options.hasGitLog) {
      parts.push(`${this.c.dim('  Git log:')} included`);
    }
    if (options.hasResume && options.sessionId) {
      parts.push(`${this.c.dim('  Session:')} resuming ${this.c.cyan(options.sessionId)}`);
    } else if (options.sessionId) {
      parts.push(`${this.c.dim('  Session:')} ${this.c.cyan(options.sessionId)}`);
    }
    if (options.payloadSizeKB !== undefined) {
      parts.push(`${this.c.dim('  Payload:')} ${options.payloadSizeKB.toFixed(1)}KB`);
    }
    if (parts.length > 0) {
      for (const part of parts) {
        this.emit(part);
      }
      this.emit('');
    }
  }

  emitRoundStart(round: number): void {
    if (this.lastRound > 0 && round > this.lastRound) {
      this.emit(this.c.dim('  ─────'));
    }
    this.lastRound = round;
    this.emit(`${this.c.cyan('◐')} Round ${round}/${this.maxRounds}: sending context to peer...`);
  }

  emitRoundWaiting(round: number, elapsedSec: number, stdoutBytes: number, stderrBytes: number): void {
    if (this.verbose) {
      const outputStatus = stdoutBytes > 0
        ? `${(stdoutBytes / 1024).toFixed(1)}KB stdout`
        : 'no output yet';
      this.emit(
        `${this.c.yellow('◑')} Round ${round}/${this.maxRounds}: waiting... ${elapsedSec}s elapsed, ${outputStatus} / ${(stderrBytes / 1024).toFixed(1)}KB stderr`,
      );
    } else {
      this.emit(
        `${this.c.yellow('◑')} Round ${round}/${this.maxRounds}: ${this.c.dim(`still thinking... ${elapsedSec}s`)}`,
      );
    }
  }

  emitRoundRetry(round: number, reason: string): void {
    this.emit(`${this.c.yellow('↻')} Round ${round}/${this.maxRounds}: ${reason}`);
  }

  emitRoundPartial(round: number, contentLength: number): void {
    this.emit(
      `${this.c.yellow('◔')} Round ${round}/${this.maxRounds}: partial response recovered (${(contentLength / 1024).toFixed(1)}KB)`,
    );
  }

  emitRoundComplete(round: number, durationMs: number, agreed: boolean): void {
    const durStr = formatDuration(durationMs);
    if (agreed) {
      this.emit(`${this.c.green('✓')} Round ${round}/${this.maxRounds}: complete (${durStr}, ${this.c.green('agreed')})`);
    } else {
      this.emit(`${this.c.yellow('○')} Round ${round}/${this.maxRounds}: complete (${durStr})`);
    }
  }

  emitRoundError(round: number, message: string): void {
    this.emit(`${this.c.red('✗')} Round ${round}/${this.maxRounds}: ${message}`);
  }

  emitDiagnostic(round: number, message: string): void {
    if (!this.verbose) return;
    this.emit(`  ${this.c.dim(`[Round ${round}] ${message}`)}`);
  }

  emitResult(agreed: boolean, rounds: number, totalDurationMs: number): void {
    const durStr = formatDuration(totalDurationMs);
    this.emit('');
    if (agreed) {
      this.emit(this.c.bold(this.c.green(`✓ Deliberation complete: agreed in ${rounds} round${rounds !== 1 ? 's' : ''} (${durStr})`)));
    } else {
      this.emit(this.c.bold(this.c.yellow(`○ Deliberation inconclusive after ${rounds} round${rounds !== 1 ? 's' : ''} (${durStr})`)));
    }
  }

  emitSessionPersisted(sessionId: string): void {
    this.emit(`  ${this.c.dim(`↳ Session persisted: ${sessionId}`)}`);
  }

  emitSessionResumed(sessionId: string): void {
    this.emit(`  ${this.c.dim(`↳ Resuming session: ${sessionId}`)}`);
  }

  emitError(message: string, remedy?: string): void {
    this.emit(`${this.c.red('✗')} ${message}`);
    if (remedy) {
      this.emit(`  ${this.c.dim(`→ ${remedy}`)}`);
    }
  }

  getElapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  private emit(line: string): void {
    this.stderr(`${line}\n`);
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remaining = secs % 60;
  return remaining > 0 ? `${mins}m${remaining}s` : `${mins}m`;
}
