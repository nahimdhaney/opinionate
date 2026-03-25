import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createExecutionTrace } from '../core/execution-trace.js';

describe('createExecutionTrace', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes per-round stdout and stderr artifacts when trace-dir is configured', async () => {
    const traceDir = mkdtempSync(join(tmpdir(), 'opinionate-trace-'));
    tempDirs.push(traceDir);

    const trace = createExecutionTrace({ traceDir, verbose: false });

    await trace.recordRoundResult({
      round: 1,
      command: ['codex', 'exec', 'hello'],
      stdout: 'peer output',
      stderr: 'peer diagnostics',
      exitCode: 0,
      signal: null,
      durationMs: 1200,
      modelSource: 'codex-default',
    });

    const artifact = readFileSync(join(traceDir, 'round-1.json'), 'utf8');
    expect(artifact).toContain('peer diagnostics');
    expect(artifact).toContain('"durationMs": 1200');
  });

  it('writes retry attempts as separate artifacts within the same logical round', async () => {
    const traceDir = mkdtempSync(join(tmpdir(), 'opinionate-trace-attempt-'));
    tempDirs.push(traceDir);

    const trace = createExecutionTrace({ traceDir, verbose: false });

    await trace.recordRoundResult({
      round: 1,
      attempt: 1,
      command: ['codex', 'exec', 'hello'],
      stdout: '',
      stderr: 'first attempt',
      exitCode: null,
      signal: 'SIGINT',
      durationMs: 1000,
      modelSource: 'codex-default',
    });

    await trace.recordRoundResult({
      round: 1,
      attempt: 2,
      command: ['codex', 'exec', 'hello'],
      stdout: 'peer output',
      stderr: 'second attempt',
      exitCode: 0,
      signal: null,
      durationMs: 1200,
      modelSource: 'codex-default',
    });

    const firstAttempt = readFileSync(join(traceDir, 'round-1-attempt-1.json'), 'utf8');
    const secondAttempt = readFileSync(join(traceDir, 'round-1-attempt-2.json'), 'utf8');

    expect(firstAttempt).toContain('"attempt": 1');
    expect(secondAttempt).toContain('"attempt": 2');
  });

  it('prints command metadata in verbose mode', () => {
    const messages: string[] = [];
    const trace = createExecutionTrace({
      verbose: true,
      showPeerCommand: true,
      stderr: (line) => messages.push(line),
    });

    trace.onRoundStart({
      round: 1,
      command: ['codex', 'exec', '-m', 'gpt-5.4', 'hello'],
      model: 'gpt-5.4',
      modelSource: 'cli',
      codexInfo: {
        version: '0.116.0',
        rawVersion: 'codex-cli 0.116.0',
        supportsExec: true,
        supportsModelFlag: true,
        supportsConfigFlag: true,
      },
      pid: 123,
    });

    expect(messages.join('\n')).toContain('Round 1');
    expect(messages.join('\n')).toContain('codex exec -m gpt-5.4 hello');
    expect(messages.join('\n')).toContain('model source: cli');
  });

  it('emits curated lifecycle diagnostics from peer stderr in verbose mode', () => {
    const messages: string[] = [];
    const trace = createExecutionTrace({
      verbose: true,
      stderr: (line) => messages.push(line),
    });

    trace.onPeerStderr(1, 'mcp: lifi failed: MCP startup failed\nreasoning effort: xhigh\n');

    expect(messages.join('\n')).toContain("peer MCP server 'lifi' failed");
    expect(messages.join('\n')).toContain('Peer reasoning effort: xhigh');
  });
});
