import { describe, expect, it } from 'vitest';
import {
  extractSessionMemoryFromContent,
  synthesizeSessionMemoryFromResult,
} from '../core/session-memory.js';

describe('session-memory', () => {
  it('parses a structured session-memory block and strips it from the visible content', () => {
    const response = [
      '**Verdict:** AGREE',
      '**Decision:** Use stateful sessions.',
      '<opinionate-session-memory>',
      JSON.stringify({
        acceptedDecisions: ['Use bounded session memory'],
        rejectedIdeas: ['Replay the full transcript forever'],
        openQuestions: ['How should sessions expire?'],
        latestRecommendation: 'Use stateful sessions.',
        latestPeerPosition: 'Persist memory outside Codex.',
      }),
      '</opinionate-session-memory>',
    ].join('\n');

    const extracted = extractSessionMemoryFromContent(response);

    expect(extracted.cleanContent).toContain('**Verdict:** AGREE');
    expect(extracted.cleanContent).not.toContain('<opinionate-session-memory>');
    expect(extracted.memory?.acceptedDecisions).toEqual(['Use bounded session memory']);
    expect(extracted.memory?.openQuestions).toContain('How should sessions expire?');
  });

  it('falls back to result-level synthesis when structured memory is missing', () => {
    const memory = synthesizeSessionMemoryFromResult({
      agreed: false,
      summary: 'No full agreement yet. The main remaining question is session expiry.',
      decision: undefined,
      recommendedPath: 'Use resumable workspace-local sessions.',
      peerPosition: 'Persist memory outside Codex and resume with file deltas.',
      keyDisagreements: ['session expiry policy is still open'],
      transcript: [],
      rounds: 2,
    });

    expect(memory.latestRecommendation).toBe('Use resumable workspace-local sessions.');
    expect(memory.latestPeerPosition).toContain('Persist memory outside Codex');
    expect(memory.openQuestions.length).toBeGreaterThan(0);
    expect(memory.source).toBe('heuristic');
  });
});
