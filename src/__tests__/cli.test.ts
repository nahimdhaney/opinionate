import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Adapter, DeliberationContext } from '../core/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFilesForContext, runCli } from '../cli.js';

function createMemoryIO() {
  let stdout = '';
  let stderr = '';

  return {
    io: {
      stdout: (chunk: string) => {
        stdout += chunk;
      },
      stderr: (chunk: string) => {
        stderr += chunk;
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

describe('runCli', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints doctor output to stderr and exits 0 when environment is ready', async () => {
    const output = createMemoryIO();
    const exitCode = await runCli(['node', 'opinionate', 'doctor'], {
      io: output.io,
      env: {},
      cwd: () => '/tmp/project',
      runDoctor: vi.fn().mockResolvedValue({
        ok: true,
        cwd: '/tmp/project',
        codex: {
          version: '0.116.0',
          rawVersion: 'codex-cli 0.116.0',
          supportsExec: true,
          supportsModelFlag: true,
          supportsConfigFlag: true,
        },
        codexAuth: { ok: true },
        skillInstalled: true,
        skillFile: '/tmp/project/.claude/skills/opinionate/SKILL.md',
        linkedBinaryPath: '/usr/local/bin/opinionate',
        model: undefined,
        modelSource: 'codex-default',
        issues: [],
        suggestions: ['Codex default model will be used.'],
      }),
    });

    expect(exitCode).toBe(0);
    expect(output.stderr()).toContain('✓ Codex CLI: v0.116.0 (exec supported)');
    expect(output.stderr()).toContain('All checks passed');
  });

  it('keeps reference-mode files path-only without reading their contents', () => {
    const output = createMemoryIO();
    const readText = vi.fn(() => 'should not be read');

    const files = loadFilesForContext(
      'docs/plan.md',
      '/tmp/project',
      output.io,
      {
        fileStrategy: 'reference',
        contextBudget: 50_000,
      },
      {
        exists: vi.fn(() => true),
        sizeBytes: vi.fn(() => 4096),
        readText,
      },
    );

    expect(files).toEqual([{ path: 'docs/plan.md', sizeBytes: 4096 }]);
    expect(readText).not.toHaveBeenCalled();
  });

  it('keeps doc-like files path-only in auto mode without reading their contents', () => {
    const output = createMemoryIO();
    const readText = vi.fn(() => '# large plan');

    const files = loadFilesForContext(
      'docs/plans/plan.md',
      '/tmp/project',
      output.io,
      {
        fileStrategy: 'auto',
        contextBudget: 50_000,
      },
      {
        exists: vi.fn(() => true),
        sizeBytes: vi.fn(() => 2048),
        readText,
      },
    );

    expect(files).toEqual([{ path: 'docs/plans/plan.md', sizeBytes: 2048 }]);
    expect(readText).not.toHaveBeenCalled();
  });

  it('still reads small code files inline in auto mode', () => {
    const output = createMemoryIO();
    const readText = vi.fn(() => 'export const value = 1;\n');

    const files = loadFilesForContext(
      'src/app.ts',
      '/tmp/project',
      output.io,
      {
        fileStrategy: 'auto',
        contextBudget: 50_000,
      },
      {
        exists: vi.fn(() => true),
        sizeBytes: vi.fn(() => 24),
        readText,
      },
    );

    expect(files).toEqual([
      {
        path: 'src/app.ts',
        content: 'export const value = 1;\n',
        sizeBytes: 24,
      },
    ]);
    expect(readText).toHaveBeenCalledOnce();
  });

  it('prints the exact codex command and round metadata in verbose mode', async () => {
    const output = createMemoryIO();

    const exitCode = await runCli(
      ['node', 'opinionate', 'run', '--mode', 'review', '--task', 'Check PR', '--verbose', '--show-peer-command'],
      {
        io: output.io,
        env: {},
        cwd: () => '/tmp/project',
        resolveAdapter: (_name, options) => {
          const adapter: Adapter = {
            name: 'fake-codex',
            initialize: vi.fn().mockResolvedValue(undefined),
            isAvailable: vi.fn().mockResolvedValue(true),
            cleanup: vi.fn().mockResolvedValue(undefined),
            sendMessage: vi.fn().mockImplementation(async (_prompt: string, _context: DeliberationContext) => {
              options.trace?.onRoundStart({
                round: 1,
                command: ['codex', 'exec', 'hello'],
                model: options.model,
                modelSource: options.modelSource,
                pid: 321,
                codexInfo: {
                  version: '0.116.0',
                  rawVersion: 'codex-cli 0.116.0',
                  supportsExec: true,
                  supportsModelFlag: true,
                  supportsConfigFlag: true,
                },
              });
              await options.trace?.onRoundFinish({
                round: 1,
                stdout: 'peer output',
                stderr: 'peer diagnostics',
                exitCode: 0,
                signal: null,
                durationMs: 12,
                command: ['codex', 'exec', 'hello'],
                model: options.model,
                modelSource: options.modelSource,
              });
              return 'I agree, this is the right approach.';
            }),
          };
          return adapter;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(output.stderr()).toContain('Round 1');
    expect(output.stderr()).toContain('codex exec');
    expect(output.stderr()).toContain('model source');
  });

  it('prints a friendly combined install and doctor report', async () => {
    const output = createMemoryIO();

    const exitCode = await runCli(['node', 'opinionate', 'install'], {
      io: output.io,
      env: {},
      cwd: () => '/tmp/project',
      installSkill: vi.fn().mockResolvedValue({
        ok: true,
        skillFile: '/tmp/project/.claude/skills/opinionate/SKILL.md',
      }),
      runDoctor: vi.fn().mockResolvedValue({
        ok: true,
        cwd: '/tmp/project',
        codex: {
          version: '0.116.0',
          rawVersion: 'codex-cli 0.116.0',
          supportsExec: true,
          supportsModelFlag: true,
          supportsConfigFlag: true,
        },
        codexAuth: { ok: true },
        skillInstalled: true,
        skillFile: '/tmp/project/.claude/skills/opinionate/SKILL.md',
        linkedBinaryPath: '/usr/local/bin/opinionate',
        model: undefined,
        modelSource: 'codex-default',
        issues: [],
        suggestions: [],
      }),
    });

    expect(exitCode).toBe(0);
    expect(output.stderr()).toContain('opinionate');
    expect(output.stderr()).toContain('Detecting environment...');
    expect(output.stderr()).toContain('Checking Codex auth...');
    expect(output.stderr()).toContain('Installing skill...');
    expect(output.stderr()).toContain('✓ Skill installed to');
    expect(output.stderr()).toContain('All checks passed.');
    expect(output.stderr()).toContain('Next:');
    expect(output.stderr()).toContain('/opinionate');
  });

  it('keeps run stateless unless --persist-session is provided', async () => {
    const output = createMemoryIO();
    const cwd = mkdtempSync(join(tmpdir(), 'opinionate-cli-stateless-'));
    tempDirs.push(cwd);

    const exitCode = await runCli(
      ['node', 'opinionate', 'run', '--mode', 'plan', '--task', 'Check statefulness'],
      {
        io: output.io,
        env: {},
        cwd: () => cwd,
        resolveAdapter: () => ({
          name: 'mock',
          initialize: vi.fn().mockResolvedValue(undefined),
          isAvailable: vi.fn().mockResolvedValue(true),
          cleanup: vi.fn().mockResolvedValue(undefined),
          sendMessage: vi.fn().mockResolvedValue('I agree, keep this simple.'),
        }),
      },
    );

    expect(exitCode).toBe(0);
    expect(output.stdout()).not.toContain('"sessionId"');
  });

  it('creates a persisted session on run and resumes it with continue', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'opinionate-cli-session-'));
    tempDirs.push(cwd);
    writeFileSync(join(cwd, 'plan.md'), 'Line 1\nLine 2\n');

    let capturedPrompt = '';
    const resolveAdapter = () => ({
      name: 'mock',
      initialize: vi.fn().mockResolvedValue(undefined),
      isAvailable: vi.fn().mockResolvedValue(true),
      cleanup: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockImplementation(async (prompt: string, _context: DeliberationContext) => {
        capturedPrompt = prompt;
        return [
          '**Verdict:** AGREE',
          '**Decision:** Use a resumable session.',
          '**Details:** This is the right direction.',
          '<opinionate-session-memory>',
          JSON.stringify({
            acceptedDecisions: ['Use resumable sessions'],
            rejectedIdeas: ['Replay the full transcript'],
            openQuestions: ['How should sessions expire?'],
            latestRecommendation: 'Use resumable sessions.',
            latestPeerPosition: 'Persist memory outside Codex.',
          }),
          '</opinionate-session-memory>',
        ].join('\n');
      }),
    });

    const first = createMemoryIO();
    const firstExit = await runCli(
      [
        'node',
        'opinionate',
        'run',
        '--persist-session',
        '--mode',
        'plan',
        '--task',
        'Review this plan',
        '--files',
        'plan.md',
      ],
      {
        io: first.io,
        env: {},
        cwd: () => cwd,
        resolveAdapter,
      },
    );

    expect(firstExit).toBe(0);
    const firstJson = JSON.parse(first.stdout());
    expect(firstJson.sessionId).toBeTruthy();
    expect(firstJson.persistedSession).toBe(true);

    writeFileSync(join(cwd, 'plan.md'), 'Line 1 updated\nLine 2\n');

    const second = createMemoryIO();
    const secondExit = await runCli(
      [
        'node',
        'opinionate',
        'continue',
        '--session',
        firstJson.sessionId,
        '--mode',
        'plan',
        '--task',
        'Review the updated plan',
        '--files',
        'plan.md',
      ],
      {
        io: second.io,
        env: {},
        cwd: () => cwd,
        resolveAdapter,
      },
    );

    expect(secondExit).toBe(0);
    const secondJson = JSON.parse(second.stdout());
    expect(secondJson.sessionId).toBe(firstJson.sessionId);
    expect(secondJson.continuedFromSession).toBe(true);
    expect(capturedPrompt).toContain('## Session Memory');
    expect(capturedPrompt).toContain('## Changes Since Last Review');
    expect(readFileSync(join(cwd, '.opinionate', 'sessions', firstJson.sessionId, 'session.json'), 'utf8')).toContain(firstJson.sessionId);
  });

  it('persists snapshots and builds deltas even when sessions use reference-mode files', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'opinionate-cli-session-reference-'));
    tempDirs.push(cwd);
    writeFileSync(join(cwd, 'docs-plan.md'), 'Line 1\nLine 2\n');

    let capturedPrompt = '';
    const resolveAdapter = () => ({
      name: 'mock',
      initialize: vi.fn().mockResolvedValue(undefined),
      isAvailable: vi.fn().mockResolvedValue(true),
      cleanup: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockImplementation(async (prompt: string) => {
        capturedPrompt = prompt;
        return [
          '**Verdict:** AGREE',
          '**Decision:** Keep using resumable sessions.',
          '<opinionate-session-memory>',
          JSON.stringify({
            acceptedDecisions: ['Persist session state'],
            rejectedIdeas: ['Start from scratch every time'],
            openQuestions: ['How much file delta should be included?'],
            latestRecommendation: 'Reuse session state.',
            latestPeerPosition: 'Reference large docs from disk.',
          }),
          '</opinionate-session-memory>',
        ].join('\n');
      }),
    });

    const first = createMemoryIO();
    const firstExit = await runCli(
      [
        'node',
        'opinionate',
        'run',
        '--persist-session',
        '--file-strategy',
        'reference',
        '--mode',
        'plan',
        '--task',
        'Review the doc',
        '--files',
        'docs-plan.md',
      ],
      {
        io: first.io,
        env: {},
        cwd: () => cwd,
        resolveAdapter,
      },
    );

    expect(firstExit).toBe(0);
    const firstJson = JSON.parse(first.stdout());

    writeFileSync(join(cwd, 'docs-plan.md'), 'Line 1 updated\nLine 2\n');

    const second = createMemoryIO();
    const secondExit = await runCli(
      [
        'node',
        'opinionate',
        'continue',
        '--session',
        firstJson.sessionId,
        '--file-strategy',
        'reference',
        '--mode',
        'plan',
        '--task',
        'Review the updated doc',
        '--files',
        'docs-plan.md',
      ],
      {
        io: second.io,
        env: {},
        cwd: () => cwd,
        resolveAdapter,
      },
    );

    expect(secondExit).toBe(0);
    expect(capturedPrompt).toContain('## Changes Since Last Review');
    expect(capturedPrompt).toContain('docs-plan.md');
    expect(capturedPrompt).toContain('+Line 1 updated');
  });

  it('emits removed deltas for files dropped from a continued session', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'opinionate-cli-session-removed-'));
    tempDirs.push(cwd);
    writeFileSync(join(cwd, 'plan-a.md'), 'Line 1\nLine 2\n');
    writeFileSync(join(cwd, 'plan-b.md'), 'Replacement plan\n');

    let capturedPrompt = '';
    const resolveAdapter = () => ({
      name: 'mock',
      initialize: vi.fn().mockResolvedValue(undefined),
      isAvailable: vi.fn().mockResolvedValue(true),
      cleanup: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockImplementation(async (prompt: string) => {
        capturedPrompt = prompt;
        return [
          '**Verdict:** AGREE',
          '**Decision:** Session delta looks good.',
          '<opinionate-session-memory>',
          JSON.stringify({
            acceptedDecisions: ['Track session file changes'],
            rejectedIdeas: [],
            openQuestions: [],
            latestRecommendation: 'Session delta looks good.',
            latestPeerPosition: 'Session delta looks good.',
          }),
          '</opinionate-session-memory>',
        ].join('\n');
      }),
    });

    const first = createMemoryIO();
    const firstExit = await runCli(
      [
        'node',
        'opinionate',
        'run',
        '--persist-session',
        '--mode',
        'plan',
        '--task',
        'Review plan A',
        '--files',
        'plan-a.md',
      ],
      {
        io: first.io,
        env: {},
        cwd: () => cwd,
        resolveAdapter,
      },
    );

    expect(firstExit).toBe(0);
    const firstJson = JSON.parse(first.stdout());

    const second = createMemoryIO();
    const secondExit = await runCli(
      [
        'node',
        'opinionate',
        'continue',
        '--session',
        firstJson.sessionId,
        '--mode',
        'plan',
        '--task',
        'Review replacement plan',
        '--files',
        'plan-b.md',
      ],
      {
        io: second.io,
        env: {},
        cwd: () => cwd,
        resolveAdapter,
      },
    );

    expect(secondExit).toBe(0);
    expect(capturedPrompt).toContain('## Changes Since Last Review');
    expect(capturedPrompt).toContain('plan-a.md');
    expect(capturedPrompt).toContain('file removed from session; prior content should not be assumed current');
    expect(capturedPrompt).toContain('plan-b.md');
  });

  it('supports one-round persisted plan loops and stops as soon as a later round agrees', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'opinionate-cli-live-loop-'));
    tempDirs.push(cwd);
    writeFileSync(join(cwd, 'plan.md'), 'Draft plan\n');

    let callCount = 0;
    const resolveAdapter = () => ({
      name: 'mock',
      initialize: vi.fn().mockResolvedValue(undefined),
      isAvailable: vi.fn().mockResolvedValue(true),
      cleanup: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return [
            '**Verdict:** DISAGREE',
            '**Decision:** The plan still needs revision.',
            '**Details:** The trust boundary is unclear.',
            '<opinionate-session-memory>',
            JSON.stringify({
              acceptedDecisions: [],
              rejectedIdeas: ['Ship the current draft'],
              openQuestions: ['How is the trust boundary enforced?'],
              latestRecommendation: 'Clarify the trust boundary before approving.',
              latestPeerPosition: 'The plan still needs revision.',
            }),
            '</opinionate-session-memory>',
          ].join('\n');
        }

        return [
          '**Verdict:** AGREE',
          '**Decision:** The revised plan is solid.',
          '**Details:** The trust boundary is now clear.',
          '<opinionate-session-memory>',
          JSON.stringify({
            acceptedDecisions: ['Clarify the trust boundary in the plan'],
            rejectedIdeas: ['Ship the current draft'],
            openQuestions: [],
            latestRecommendation: 'The revised plan is solid.',
            latestPeerPosition: 'The revised plan is solid.',
          }),
          '</opinionate-session-memory>',
        ].join('\n');
      }),
    });

    const first = createMemoryIO();
    const firstExit = await runCli(
      [
        'node',
        'opinionate',
        'run',
        '--persist-session',
        '--max-rounds',
        '1',
        '--mode',
        'plan',
        '--task',
        'Review this plan',
        '--files',
        'plan.md',
      ],
      {
        io: first.io,
        env: {},
        cwd: () => cwd,
        resolveAdapter,
      },
    );

    expect(firstExit).toBe(0);
    const firstJson = JSON.parse(first.stdout());
    expect(firstJson.agreed).toBe(false);
    expect(firstJson.rounds).toBe(1);
    expect(firstJson.sessionId).toBeTruthy();
    expect(firstJson.peerPosition).toContain('The plan still needs revision.');
    expect(callCount).toBe(1);

    writeFileSync(join(cwd, 'plan.md'), 'Draft plan\nClarified trust boundary.\n');

    const second = createMemoryIO();
    const secondExit = await runCli(
      [
        'node',
        'opinionate',
        'continue',
        '--session',
        firstJson.sessionId,
        '--max-rounds',
        '1',
        '--mode',
        'plan',
        '--task',
        'Clarified the trust boundary',
        '--files',
        'plan.md',
      ],
      {
        io: second.io,
        env: {},
        cwd: () => cwd,
        resolveAdapter,
      },
    );

    expect(secondExit).toBe(0);
    const secondJson = JSON.parse(second.stdout());
    expect(secondJson.agreed).toBe(true);
    expect(secondJson.rounds).toBe(1);
    expect(secondJson.sessionId).toBe(firstJson.sessionId);
    expect(secondJson.peerPosition).toContain('The revised plan is solid.');
    expect(callCount).toBe(2);
  });

  it('treats approval-grade peer responses as agreement in one-round persisted sessions', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'opinionate-cli-live-loop-approval-'));
    tempDirs.push(cwd);
    writeFileSync(join(cwd, 'plan.md'), 'Draft plan\n');

    let callCount = 0;
    const resolveAdapter = () => ({
      name: 'mock',
      initialize: vi.fn().mockResolvedValue(undefined),
      isAvailable: vi.fn().mockResolvedValue(true),
      cleanup: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return [
            '**Verdict:** DISAGREE',
            '**Decision:** The plan still needs revision.',
            '**Details:** The rollout safety controls are underspecified.',
            '<opinionate-session-memory>',
            JSON.stringify({
              acceptedDecisions: [],
              rejectedIdeas: ['Ship the current draft'],
              openQuestions: ['How do we gate rollout safety?'],
              latestRecommendation: 'Add explicit rollout controls before approving.',
              latestPeerPosition: 'The plan still needs revision.',
            }),
            '</opinionate-session-memory>',
          ].join('\n');
        }

        return [
          'No blocking findings. I would now treat the revised rollout plan as launch-ready at the planning level.',
          '<opinionate-session-memory>',
          JSON.stringify({
            acceptedDecisions: ['Add explicit rollout safety controls'],
            rejectedIdeas: ['Ship the current draft'],
            openQuestions: [],
            latestRecommendation: 'The revised rollout plan is launch-ready at the planning level.',
            latestPeerPosition: 'No blocking findings remain.',
          }),
          '</opinionate-session-memory>',
        ].join('\n');
      }),
    });

    const first = createMemoryIO();
    const firstExit = await runCli(
      [
        'node',
        'opinionate',
        'run',
        '--persist-session',
        '--max-rounds',
        '1',
        '--mode',
        'plan',
        '--task',
        'Review this rollout plan',
        '--files',
        'plan.md',
      ],
      {
        io: first.io,
        env: {},
        cwd: () => cwd,
        resolveAdapter,
      },
    );

    expect(firstExit).toBe(0);
    const firstJson = JSON.parse(first.stdout());
    expect(firstJson.agreed).toBe(false);
    expect(firstJson.sessionId).toBeTruthy();

    writeFileSync(join(cwd, 'plan.md'), 'Draft plan\nAdded rollout safety controls.\n');

    const second = createMemoryIO();
    const secondExit = await runCli(
      [
        'node',
        'opinionate',
        'continue',
        '--session',
        firstJson.sessionId,
        '--max-rounds',
        '1',
        '--mode',
        'plan',
        '--task',
        'Added rollout safety controls',
        '--files',
        'plan.md',
      ],
      {
        io: second.io,
        env: {},
        cwd: () => cwd,
        resolveAdapter,
      },
    );

    expect(secondExit).toBe(0);
    const secondJson = JSON.parse(second.stdout());
    expect(secondJson.agreed).toBe(true);
    expect(secondJson.sessionId).toBe(firstJson.sessionId);
    expect(secondJson.continuedFromSession).toBe(true);
    expect(secondJson.peerPosition).toContain('launch-ready at the planning level');
    expect(callCount).toBe(2);
  });
});
