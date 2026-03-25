import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, it, expect } from 'vitest';
import { ContextBuilder } from '../core/context-builder.js';
import type { DeliberationContext, DeliberationMessage, FileContext } from '../core/types.js';

function makeMessage(
  role: 'orchestrator' | 'peer',
  content: string,
  round: number,
): DeliberationMessage {
  return { role, content, round, timestamp: Date.now() };
}

describe('ContextBuilder', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('builds a prompt payload with all context sections', () => {
    const builder = new ContextBuilder(50_000, '/tmp/test');
    const context: DeliberationContext = {
      task: 'Design auth system',
      files: [{ path: 'src/auth.ts', content: 'export function login() {}' }],
      gitLog: 'abc123 initial commit',
      conversationSummary: 'User wants OAuth2',
      cwd: '/tmp/test',
    };

    const payload = builder.buildPromptPayload('What approach?', context, [], 1);

    expect(payload).toContain('## Task');
    expect(payload).toContain('Design auth system');
    expect(payload).toContain('## Current Prompt');
    expect(payload).toContain('What approach?');
    expect(payload).toContain('## Conversation Context');
    expect(payload).toContain('OAuth2');
    expect(payload).toContain('## Recent Git History');
    expect(payload).toContain('## Relevant Files');
    expect(payload).toContain('src/auth.ts');
  });

  it('excludes transcript on round 1', () => {
    const builder = new ContextBuilder(50_000, '/tmp/test');
    const context: DeliberationContext = { task: 'Test', cwd: '/tmp/test' };

    const payload = builder.buildPromptPayload('Prompt', context, [], 1);
    expect(payload).not.toContain('## Deliberation History');
  });

  it('includes transcript on round 2+', () => {
    const builder = new ContextBuilder(50_000, '/tmp/test');
    const context: DeliberationContext = { task: 'Test', cwd: '/tmp/test' };
    const transcript = [
      makeMessage('orchestrator', 'Initial question', 1),
      makeMessage('peer', 'My response', 1),
    ];

    const payload = builder.buildPromptPayload('Follow up', context, transcript, 2);
    expect(payload).toContain('## Deliberation History');
    expect(payload).toContain('My response');
  });

  it('switches to reference-only file context when files exceed the auto budget threshold', () => {
    const builder = new ContextBuilder(500, '/tmp/test');
    const bigContent = 'x'.repeat(2000);
    const context: DeliberationContext = {
      task: 'Test',
      files: [{ path: 'big.ts', content: bigContent }],
      cwd: '/tmp/test',
    };

    const payload = builder.buildPromptPayload('Prompt', context, [], 1);
    const payloadSize = Buffer.byteLength(payload, 'utf-8');

    expect(payload).toContain('## Relevant Files (read from disk)');
    expect(payload).toContain('- big.ts');
    expect(payload).not.toContain(bigContent);
    expect(payloadSize).toBeLessThan(2000);
  });

  it('filters out sensitive files', () => {
    const builder = new ContextBuilder(50_000, '/tmp/test');
    const files: FileContext[] = [
      { path: 'src/app.ts', content: 'app code' },
      { path: '.env', content: 'SECRET=abc' },
      { path: 'credentials.json', content: '{"key": "value"}' },
      { path: 'server.pem', content: 'cert data' },
    ];

    const filtered = builder.filterFiles(files);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.path).toBe('src/app.ts');
  });

  it('filters relative paths against project ignore rules', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'opinionate-context-builder-'));
    tempDirs.push(cwd);
    writeFileSync(join(cwd, '.opinionateignore'), 'docs/plans/plan.md\n', 'utf8');

    const builder = new ContextBuilder(50_000, cwd);
    const files: FileContext[] = [
      { path: 'docs/plans/plan.md', content: '# plan' },
      { path: 'src/app.ts', content: 'export const app = true;\n' },
    ];

    const filtered = builder.filterFiles(files);

    expect(filtered).toEqual([{ path: 'src/app.ts', content: 'export const app = true;\n' }]);
  });

  it('summarizes transcript when it exceeds budget', () => {
    // Use a very tight budget so transcript summarization kicks in
    const builder = new ContextBuilder(800, '/tmp/test');
    const context: DeliberationContext = { task: 'Test', cwd: '/tmp/test' };

    // Create a long transcript (5 rounds) with verbose messages
    const transcript: DeliberationMessage[] = [];
    const longText = 'This is a detailed message about the architecture and design considerations that spans multiple sentences and uses a significant amount of the context budget. ';
    for (let round = 1; round <= 5; round++) {
      transcript.push(makeMessage('orchestrator', `${longText} Question for round ${round}.`, round));
      transcript.push(makeMessage('peer', `${longText} Response for round ${round}.`, round));
    }

    const payload = builder.buildPromptPayload('Round 6 prompt', context, transcript, 6);

    // Should contain summarized older rounds
    expect(payload).toContain('summarized');
    // Should still contain at least one of the recent rounds
    const hasRecentRound = payload.includes('Round 4') || payload.includes('Round 5');
    expect(hasRecentRound).toBe(true);
  });

  it('renders file references instead of inline content when reference mode is requested', () => {
    const builder = new ContextBuilder(50_000, '/tmp/test');
    const context: DeliberationContext = {
      task: 'Review the plan',
      fileStrategy: 'reference',
      files: [{ path: 'docs/plan.md', content: 'very large content that should not be inlined' }],
      cwd: '/tmp/test',
    };

    const payload = builder.buildPromptPayload('Prompt', context, [], 1);

    expect(payload).toContain('## Relevant Files (read from disk)');
    expect(payload).toContain('- docs/plan.md');
    expect(payload).not.toContain('very large content');
  });

  it('renders resume memory and file deltas as separate sections', () => {
    const builder = new ContextBuilder(50_000, '/tmp/test');
    const context: DeliberationContext = {
      task: 'Continue the plan review',
      cwd: '/tmp/test',
      resumeMemory: {
        summary: 'Previous review recommended stateful sessions.',
        acceptedDecisions: ['Use bounded session memory'],
        rejectedIdeas: ['Replay the full transcript every time'],
        openQuestions: ['How should session expiry work?'],
        latestRecommendation: 'Add resumable sessions.',
        latestPeerPosition: 'Persist memory outside Codex.',
        source: 'structured',
      },
      fileDeltas: [
        {
          path: 'docs/plans/session.md',
          status: 'changed',
          summary: '3 lines changed',
          diff: '@@\n-old line\n+new line',
          changedLineCount: 2,
        },
      ],
    };

    const payload = builder.buildPromptPayload('Follow up on the revised plan', context, [], 1);

    expect(payload).toContain('## Session Memory');
    expect(payload).toContain('Use bounded session memory');
    expect(payload).toContain('## Changes Since Last Review');
    expect(payload).toContain('docs/plans/session.md');
    expect(payload).toContain('+new line');
  });
});
