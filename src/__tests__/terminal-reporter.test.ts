import { describe, expect, it } from 'vitest';
import { TerminalReporter } from '../util/terminal-reporter.js';

function createReporter(options: { verbose?: boolean } = {}) {
  const lines: string[] = [];
  const reporter = new TerminalReporter({
    stderr: (chunk) => lines.push(chunk.trimEnd()),
    verbose: options.verbose ?? false,
    mode: 'plan',
    maxRounds: 5,
    colorSupport: { enabled: false },
  });
  return { reporter, lines };
}

describe('TerminalReporter', () => {
  it('emits a header with mode and max rounds', () => {
    const { reporter, lines } = createReporter();
    reporter.emitHeader('codex-cli');
    expect(lines.some(l => l.includes('opinionate'))).toBe(true);
    expect(lines.some(l => l.includes('plan'))).toBe(true);
    expect(lines.some(l => l.includes('5 rounds max'))).toBe(true);
  });

  it('emits round lifecycle with correct symbols', () => {
    const { reporter, lines } = createReporter();
    reporter.emitRoundStart(1);
    reporter.emitRoundWaiting(1, 15, 0, 1024);
    reporter.emitRoundComplete(1, 42000, true);

    expect(lines.some(l => l.includes('◐') && l.includes('Round 1/5'))).toBe(true);
    expect(lines.some(l => l.includes('◑') && l.includes('15s'))).toBe(true);
    expect(lines.some(l => l.includes('✓') && l.includes('42s') && l.includes('agreed'))).toBe(true);
  });

  it('emits retry with arrow symbol', () => {
    const { reporter, lines } = createReporter();
    reporter.emitRoundRetry(1, 'timed out, retrying with reference files');
    expect(lines.some(l => l.includes('↻'))).toBe(true);
  });

  it('emits error with cross symbol', () => {
    const { reporter, lines } = createReporter();
    reporter.emitRoundError(2, 'peer timed out after 300s');
    expect(lines.some(l => l.includes('✗') && l.includes('timed out'))).toBe(true);
  });

  it('emits final result line', () => {
    const { reporter, lines } = createReporter();
    reporter.emitResult(true, 2, 84000);
    expect(lines.some(l => l.includes('agreed in 2 rounds'))).toBe(true);
  });

  it('emits inconclusive result', () => {
    const { reporter, lines } = createReporter();
    reporter.emitResult(false, 5, 300000);
    expect(lines.some(l => l.includes('inconclusive') && l.includes('5 rounds'))).toBe(true);
  });

  it('emits session lifecycle', () => {
    const { reporter, lines } = createReporter();
    reporter.emitSessionPersisted('20260323-151422-k4x9pt');
    reporter.emitSessionResumed('20260323-151422-k4x9pt');
    expect(lines.some(l => l.includes('persisted') && l.includes('k4x9pt'))).toBe(true);
    expect(lines.some(l => l.includes('Resuming') && l.includes('k4x9pt'))).toBe(true);
  });

  it('suppresses diagnostics in non-verbose mode', () => {
    const { reporter, lines } = createReporter({ verbose: false });
    reporter.emitDiagnostic(1, 'prompt payload size: 12KB');
    expect(lines).toHaveLength(0);
  });

  it('shows diagnostics in verbose mode', () => {
    const { reporter, lines } = createReporter({ verbose: true });
    reporter.emitDiagnostic(1, 'prompt payload size: 12KB');
    expect(lines.some(l => l.includes('12KB'))).toBe(true);
  });

  it('emits error with remedy', () => {
    const { reporter, lines } = createReporter();
    reporter.emitError('Codex not found', 'Run: npm install -g @openai/codex');
    expect(lines.some(l => l.includes('✗') && l.includes('Codex not found'))).toBe(true);
    expect(lines.some(l => l.includes('npm install'))).toBe(true);
  });
});
