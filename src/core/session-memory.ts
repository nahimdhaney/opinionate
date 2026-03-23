import type { DeliberationResult, DeliberationSessionMemory } from './types.js';

const MEMORY_BLOCK_PATTERN =
  /<opinionate-session-memory>\s*([\s\S]*?)\s*<\/opinionate-session-memory>/i;

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export function extractSessionMemoryFromContent(content: string): {
  cleanContent: string;
  memory?: DeliberationSessionMemory;
} {
  const match = content.match(MEMORY_BLOCK_PATTERN);
  if (!match) {
    return {
      cleanContent: content.trim(),
    };
  }

  const cleanContent = content.replace(MEMORY_BLOCK_PATTERN, '').trim();
  try {
    const parsed = JSON.parse(match[1]!);
    return {
      cleanContent,
      memory: {
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        acceptedDecisions: normalizeStringArray(parsed.acceptedDecisions),
        rejectedIdeas: normalizeStringArray(parsed.rejectedIdeas),
        openQuestions: normalizeStringArray(parsed.openQuestions),
        latestRecommendation:
          typeof parsed.latestRecommendation === 'string' ? parsed.latestRecommendation : undefined,
        latestPeerPosition:
          typeof parsed.latestPeerPosition === 'string' ? parsed.latestPeerPosition : undefined,
        source: 'structured',
      },
    };
  } catch {
    return { cleanContent };
  }
}

export function synthesizeSessionMemoryFromResult(
  result: DeliberationResult,
  structured?: DeliberationSessionMemory,
): DeliberationSessionMemory {
  if (structured) {
    return {
      ...structured,
      summary: structured.summary || result.summary,
      latestRecommendation:
        structured.latestRecommendation || result.decision || result.recommendedPath,
      latestPeerPosition: structured.latestPeerPosition || result.peerPosition,
      source: 'structured',
    };
  }

  const latestRecommendation = result.decision ?? result.recommendedPath;
  const acceptedDecisions = result.agreed && latestRecommendation ? [latestRecommendation] : [];
  const openQuestions = result.keyDisagreements.length > 0
    ? [...result.keyDisagreements]
    : result.agreed
      ? []
      : ['Further clarification is still needed.'];

  return {
    summary: result.summary,
    acceptedDecisions,
    rejectedIdeas: [],
    openQuestions,
    latestRecommendation,
    latestPeerPosition: result.peerPosition,
    source: 'heuristic',
  };
}
