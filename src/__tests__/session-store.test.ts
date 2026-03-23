import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendSessionRun,
  createSession,
  generateSessionId,
  loadSession,
  pruneExpiredSessions,
  saveSession,
  updateSessionMemory,
} from '../core/session-store.js';

describe('session-store', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('generates human-usable session ids', () => {
    const id = generateSessionId(new Date('2026-03-23T15:14:22.000Z'), () => 0.123456);
    expect(id).toMatch(/^\d{8}-\d{6}-[a-z0-9]{6}$/);
  });

  it('creates, loads, updates, and appends session state', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'opinionate-session-'));
    tempDirs.push(cwd);

    const session = await createSession({
      cwd,
      mode: 'plan',
      task: 'Improve the session model',
      id: '20260323-151422-k4x9pt',
    });

    expect(session.id).toBe('20260323-151422-k4x9pt');

    await updateSessionMemory(cwd, session.id, {
      summary: 'Codex recommended the bounded-memory approach.',
      acceptedDecisions: ['Use bounded session memory'],
      rejectedIdeas: ['Keep replaying the full transcript'],
      openQuestions: ['How large should deltas be?'],
      latestRecommendation: 'Use stateful sessions.',
      latestPeerPosition: 'Persist memory outside Codex.',
      source: 'structured',
    });

    await appendSessionRun(cwd, session.id, {
      id: 'run-1',
      startedAt: Date.now(),
      completedAt: Date.now(),
      mode: 'plan',
      task: 'Improve the session model',
      rounds: 2,
      agreed: true,
      summary: 'Reached agreement on stateful sessions.',
    });

    const loaded = await loadSession(cwd, session.id);
    expect(loaded.memory.acceptedDecisions).toContain('Use bounded session memory');
    expect(loaded.runs).toHaveLength(1);
    expect(loaded.runs[0]!.id).toBe('run-1');
    expect(loaded.status).toBe('active');

    const onDisk = JSON.parse(
      readFileSync(join(cwd, '.opinionate', 'sessions', session.id, 'session.json'), 'utf8'),
    );
    expect(onDisk.id).toBe(session.id);
  });

  it('supports explicitly marking a session completed when appending a run', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'opinionate-session-status-'));
    tempDirs.push(cwd);

    const session = await createSession({
      cwd,
      mode: 'review',
      task: 'Finalize the review loop',
      id: '20260323-151500-done42',
    });

    await appendSessionRun(
      cwd,
      session.id,
      {
        id: 'run-1',
        startedAt: Date.now(),
        completedAt: Date.now(),
        mode: 'review',
        task: 'Finalize the review loop',
        rounds: 1,
        agreed: true,
        summary: 'Done.',
      },
      { status: 'completed' },
    );

    const loaded = await loadSession(cwd, session.id);
    expect(loaded.status).toBe('completed');
  });

  it('prunes expired completed sessions but preserves active ones', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'opinionate-prune-'));
    tempDirs.push(cwd);

    const completed = await createSession({
      cwd,
      mode: 'plan',
      task: 'Old session',
      id: '20260320-101010-old123',
    });
    completed.status = 'completed';
    completed.updatedAt = Date.now() - 40 * 24 * 60 * 60 * 1000;
    completed.lastAccessedAt = completed.updatedAt;
    await saveSession(cwd, completed);

    const active = await createSession({
      cwd,
      mode: 'review',
      task: 'Active session',
      id: '20260323-151422-live12',
    });
    active.status = 'active';
    active.updatedAt = Date.now() - 40 * 24 * 60 * 60 * 1000;
    active.lastAccessedAt = active.updatedAt;
    await saveSession(cwd, active);

    const pruned = await pruneExpiredSessions(cwd, {
      now: Date.now(),
      ttlMs: 30 * 24 * 60 * 60 * 1000,
    });

    expect(pruned).toBe(1);
    await expect(loadSession(cwd, completed.id)).rejects.toThrow(/not found/i);
    await expect(loadSession(cwd, active.id)).resolves.toBeTruthy();
  });
});
