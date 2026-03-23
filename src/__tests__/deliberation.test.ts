import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import { CodexCliAdapter } from '../adapters/codex-cli.js';
import { Deliberation } from '../core/deliberation.js';
import type { Adapter, DeliberationContext } from '../core/types.js';
import { DeliberationError } from '../core/types.js';

function createMockAdapter(responses: string[]): Adapter {
  let callIndex = 0;
  return {
    name: 'mock',
    initialize: vi.fn().mockResolvedValue(undefined),
    isAvailable: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockImplementation(async () => {
      const response = responses[callIndex] ?? 'No more responses';
      callIndex++;
      return response;
    }),
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockChild(stdoutText: string, stderrText = '', exitCode = 0) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.pid = 1234;

  queueMicrotask(() => {
    if (stdoutText) {
      child.stdout.emit('data', Buffer.from(stdoutText));
    }
    if (stderrText) {
      child.stderr.emit('data', Buffer.from(stderrText));
    }
    child.emit('close', exitCode, null);
  });

  return child;
}

describe('Deliberation', () => {
  const baseContext: DeliberationContext = {
    task: 'Design the caching layer',
    cwd: '/tmp/test',
  };

  it('runs a deliberation and returns a result', async () => {
    const adapter = createMockAdapter([
      'I recommend using Redis with LRU eviction. Sounds good as an approach.',
    ]);

    const deliberation = new Deliberation({
      mode: 'plan',
      peerAdapter: adapter,
      context: baseContext,
      maxRounds: 3,
      timeout: 5000,
      contextBudget: 50_000,
    });

    const result = await deliberation.run();

    expect(result.transcript.length).toBeGreaterThanOrEqual(2);
    expect(result.rounds).toBeGreaterThanOrEqual(1);
    expect(result.summary).toBeTruthy();
    expect(adapter.initialize).toHaveBeenCalled();
    expect(adapter.cleanup).toHaveBeenCalled();
  });

  it('reaches agreement when peer agrees', async () => {
    const adapter = createMockAdapter([
      'I agree, let\'s go with Redis for caching. That works well for this use case.',
    ]);

    const deliberation = new Deliberation({
      mode: 'plan',
      peerAdapter: adapter,
      context: baseContext,
      maxRounds: 5,
      timeout: 5000,
      contextBudget: 50_000,
    });

    const result = await deliberation.run();

    expect(result.agreed).toBe(true);
    expect(result.decision).toBeTruthy();
    expect(result.rounds).toBe(1);
  });

  it('returns inconclusive after max rounds with disagreement', async () => {
    const adapter = createMockAdapter([
      'I disagree, we should use Memcached instead.',
      'I still think Memcached is better. The problem with Redis is memory overhead.',
      'However I think we need to reconsider. Redis has too much complexity.',
    ]);

    const deliberation = new Deliberation({
      mode: 'decide',
      peerAdapter: adapter,
      context: baseContext,
      maxRounds: 3,
      timeout: 5000,
      contextBudget: 50_000,
    });

    const result = await deliberation.run();

    expect(result.agreed).toBe(false);
    expect(result.rounds).toBe(3);
    expect(result.recommendedPath).toBeTruthy();
    expect(result.peerPosition).toBeTruthy();
  });

  it('calls onRoundComplete callback', async () => {
    const adapter = createMockAdapter([
      'Interesting approach. I think we should explore more options.',
      'I agree, that works well.',
    ]);

    const onRoundComplete = vi.fn();

    const deliberation = new Deliberation({
      mode: 'plan',
      peerAdapter: adapter,
      context: baseContext,
      maxRounds: 5,
      timeout: 5000,
      contextBudget: 50_000,
      onRoundComplete,
    });

    await deliberation.run();

    expect(onRoundComplete).toHaveBeenCalled();
    expect(onRoundComplete.mock.calls[0]![0]).toBe(1); // first round
  });

  it('throws when peer adapter is unavailable', async () => {
    const adapter = createMockAdapter([]);
    (adapter.isAvailable as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const deliberation = new Deliberation({
      mode: 'plan',
      peerAdapter: adapter,
      context: baseContext,
      maxRounds: 3,
      timeout: 5000,
      contextBudget: 50_000,
    });

    await expect(deliberation.run()).rejects.toThrow(DeliberationError);
    await expect(deliberation.run()).rejects.toThrow('not available');
  });

  it('handles adapter errors gracefully', async () => {
    const adapter = createMockAdapter([]);
    (adapter.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DeliberationError('Connection failed', 'ADAPTER_ERROR', 1),
    );

    const deliberation = new Deliberation({
      mode: 'debug',
      peerAdapter: adapter,
      context: baseContext,
      maxRounds: 3,
      timeout: 5000,
      contextBudget: 50_000,
    });

    await expect(deliberation.run()).rejects.toThrow('Connection failed');
  });

  it('supports all four deliberation modes', async () => {
    for (const mode of ['plan', 'review', 'debug', 'decide'] as const) {
      const adapter = createMockAdapter(['I agree, sounds good.']);

      const deliberation = new Deliberation({
        mode,
        peerAdapter: adapter,
        context: baseContext,
        maxRounds: 2,
        timeout: 5000,
        contextBudget: 50_000,
      });

      const result = await deliberation.run();
      expect(result.transcript.length).toBeGreaterThanOrEqual(2);

      // Verify the orchestrator prompt contains mode-appropriate language
      const firstMessage = result.transcript[0]!;
      expect(firstMessage.role).toBe('orchestrator');
    }
  });

  it('cleans up adapter even on error', async () => {
    const adapter = createMockAdapter([]);
    (adapter.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));

    const deliberation = new Deliberation({
      mode: 'plan',
      peerAdapter: adapter,
      context: baseContext,
      maxRounds: 3,
      timeout: 5000,
      contextBudget: 50_000,
    });

    await expect(deliberation.run()).rejects.toThrow();
    expect(adapter.cleanup).toHaveBeenCalled();
  });

  it('works with orchestratorAdapter provided', async () => {
    const peerAdapter = createMockAdapter(['I agree with that approach. LGTM.']);
    const orchestratorAdapter = createMockAdapter([
      'Let me propose: we should use a layered caching strategy with Redis.',
    ]);

    const deliberation = new Deliberation({
      mode: 'plan',
      peerAdapter,
      orchestratorAdapter,
      context: baseContext,
      maxRounds: 3,
      timeout: 5000,
      contextBudget: 50_000,
    });

    const result = await deliberation.run();

    expect(orchestratorAdapter.sendMessage).toHaveBeenCalled();
    expect(peerAdapter.sendMessage).toHaveBeenCalled();
    expect(result.transcript.length).toBeGreaterThanOrEqual(2);
  });

  it('passes no model flag to codex when the user did not override model', async () => {
    let spawnedArgs: string[] | undefined;
    const adapter = new CodexCliAdapter({
      timeout: 1000,
      which: vi.fn().mockResolvedValue('/usr/local/bin/codex'),
      detectCliInfo: vi.fn().mockResolvedValue({
        version: '0.116.0',
        rawVersion: 'codex-cli 0.116.0',
        supportsExec: true,
        supportsModelFlag: true,
        supportsConfigFlag: true,
      }),
      spawnProcess: vi.fn().mockImplementation((_command: string, args: string[]) => {
        spawnedArgs = args;
        return createMockChild('ok');
      }),
    });

    await adapter.initialize();
    await adapter.sendMessage('hello', baseContext);

    expect(spawnedArgs).toEqual(['exec', 'hello']);
  });

  it('falls back to config override when model flag is unavailable', async () => {
    let spawnedArgs: string[] | undefined;
    const adapter = new CodexCliAdapter({
      timeout: 1000,
      model: 'gpt-5.4',
      which: vi.fn().mockResolvedValue('/usr/local/bin/codex'),
      detectCliInfo: vi.fn().mockResolvedValue({
        version: '0.71.0',
        rawVersion: 'codex-cli 0.71.0',
        supportsExec: true,
        supportsModelFlag: false,
        supportsConfigFlag: true,
      }),
      spawnProcess: vi.fn().mockImplementation((_command: string, args: string[]) => {
        spawnedArgs = args;
        return createMockChild('ok');
      }),
    });

    await adapter.initialize();
    await adapter.sendMessage('hello', baseContext);

    expect(spawnedArgs).toEqual(['exec', '-c', 'model=\"gpt-5.4\"', 'hello']);
  });
});
