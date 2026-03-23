import { describe, it, expect } from 'vitest';
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

  it('respects budget by truncating files', () => {
    const builder = new ContextBuilder(500, '/tmp/test');
    const bigContent = 'x'.repeat(2000);
    const context: DeliberationContext = {
      task: 'Test',
      files: [{ path: 'big.ts', content: bigContent }],
      cwd: '/tmp/test',
    };

    const payload = builder.buildPromptPayload('Prompt', context, [], 1);
    const payloadSize = Buffer.byteLength(payload, 'utf-8');

    // Payload should be reasonably bounded (not contain the full 2000 chars)
    expect(payload).toContain('[truncated]');
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
});
