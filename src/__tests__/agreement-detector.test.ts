import { describe, it, expect, beforeEach } from 'vitest';
import { AgreementDetector } from '../core/agreement-detector.js';
import type { DeliberationMessage } from '../core/types.js';

function makeMessage(
  role: 'orchestrator' | 'peer',
  content: string,
  round: number,
): DeliberationMessage {
  return { role, content, round, timestamp: Date.now() };
}

describe('AgreementDetector', () => {
  let detector: AgreementDetector;

  beforeEach(() => {
    detector = new AgreementDetector();
  });

  it('detects agreement from explicit signal', () => {
    const transcript: DeliberationMessage[] = [
      makeMessage('orchestrator', 'Should we use REST or GraphQL?', 1),
      makeMessage('peer', 'I think REST is the way to go. Sounds good to use REST for this API.', 1),
    ];

    const result = detector.evaluate(transcript, 1);
    expect(result.agreed).toBe(true);
    expect(result.synthesized.decision).toBeTruthy();
    expect(result.synthesized.keyDisagreements).toEqual([]);
  });

  it('detects disagreement from explicit signal', () => {
    const transcript: DeliberationMessage[] = [
      makeMessage('orchestrator', 'Lets use REST.', 1),
      makeMessage('peer', 'I disagree. GraphQL would be better because of the flexible queries.', 1),
    ];

    const result = detector.evaluate(transcript, 1);
    expect(result.agreed).toBe(false);
    expect(result.synthesized.keyDisagreements!.length).toBeGreaterThan(0);
  });

  it('detects convergence via proposal stability across rounds', () => {
    const transcript: DeliberationMessage[] = [
      makeMessage('orchestrator', 'How should we implement caching?', 1),
      makeMessage('peer', 'Use Redis for session caching with a TTL of 3600 seconds and LRU eviction.', 1),
      makeMessage('orchestrator', 'What about the TTL strategy?', 2),
      makeMessage('peer', 'Redis with LRU eviction and a 3600 second TTL is the right approach for session caching.', 2),
    ];

    // Round 1
    detector.evaluate(transcript.slice(0, 2), 1);
    // Round 2 — similar content should trigger stability bonus
    const result = detector.evaluate(transcript, 2);
    expect(result.agreed).toBe(true);
  });

  it('returns inconclusive with no signals', () => {
    const transcript: DeliberationMessage[] = [
      makeMessage('orchestrator', 'What do you think about the database schema?', 1),
      makeMessage('peer', 'We could normalize the tables or keep them denormalized. There are trade-offs either way.', 1),
    ];

    const result = detector.evaluate(transcript, 1);
    expect(result.agreed).toBe(false);
  });

  it('resets state correctly', () => {
    const transcript: DeliberationMessage[] = [
      makeMessage('orchestrator', 'Use REST?', 1),
      makeMessage('peer', 'Sounds good, REST works for this.', 1),
    ];

    const result1 = detector.evaluate(transcript, 1);
    expect(result1.agreed).toBe(true);

    detector.reset();

    // Same transcript after reset should evaluate fresh
    const transcript2: DeliberationMessage[] = [
      makeMessage('orchestrator', 'What about performance?', 1),
      makeMessage('peer', 'We need to investigate further.', 1),
    ];

    const result2 = detector.evaluate(transcript2, 1);
    expect(result2.agreed).toBe(false);
  });

  it('populates peerPosition from latest peer message', () => {
    const transcript: DeliberationMessage[] = [
      makeMessage('orchestrator', 'Options?', 1),
      makeMessage('peer', 'I recommend approach B with microservices.', 1),
    ];

    const result = detector.evaluate(transcript, 1);
    expect(result.synthesized.peerPosition).toContain('approach B');
  });

  it('builds summary with round count', () => {
    const transcript: DeliberationMessage[] = [
      makeMessage('orchestrator', 'Plan?', 1),
      makeMessage('peer', 'I disagree with the monolith approach. Instead I\'d suggest microservices.', 1),
    ];

    const result = detector.evaluate(transcript, 1);
    expect(result.synthesized.summary).toContain('1 round');
    expect(result.synthesized.summary).toContain('no clear agreement');
  });

  it('treats a structured AGREE verdict as a strong agreement signal', () => {
    const transcript: DeliberationMessage[] = [
      makeMessage('orchestrator', 'What should we do?', 1),
      makeMessage(
        'peer',
        '**Verdict:** AGREE\n**Decision:** Keep the current design.\n**Details:** I agree this is the right approach.',
        1,
      ),
    ];

    const result = detector.evaluate(transcript, 1);
    expect(result.agreed).toBe(true);
  });

  it('lets a structured DISAGREE verdict override mixed agreement language', () => {
    const transcript: DeliberationMessage[] = [
      makeMessage('orchestrator', 'Should we keep this design?', 1),
      makeMessage(
        'peer',
        '**Verdict:** DISAGREE\n**Decision:** Change the design.\n**Details:** I agree the problem is real, but I disagree with the proposed fix and would take an alternative approach.',
        1,
      ),
    ];

    const result = detector.evaluate(transcript, 1);
    expect(result.agreed).toBe(false);
    expect(result.synthesized.keyDisagreements!.length).toBeGreaterThan(0);
  });
});
