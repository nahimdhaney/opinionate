import type { DeliberationMessage, DeliberationResult } from './types.js';

const AGREEMENT_SIGNALS = [
  'i agree',
  "let's go with",
  'sounds good',
  'that works',
  'lgtm',
  'concur',
  'aligned',
  'makes sense',
  'good approach',
  'right approach',
  'i like that',
  'that\'s a solid',
  'on board with',
  'works for me',
];

const DISAGREEMENT_SIGNALS = [
  'i disagree',
  'however i think',
  'instead i\'d suggest',
  'the problem with that',
  'i\'d push back',
  'not convinced',
  'concern with',
  'alternative approach',
  'rather than that',
  'i\'d recommend against',
  'won\'t work because',
  'issue with this',
];

interface SynthesisState {
  score: number;
  stableProposal: string | null;
  previousPeerContent: string | null;
  peerPosition: string;
  keyDisagreements: string[];
}

export class AgreementDetector {
  private state: SynthesisState = {
    score: 0,
    stableProposal: null,
    previousPeerContent: null,
    peerPosition: '',
    keyDisagreements: [],
  };

  evaluate(transcript: DeliberationMessage[], round: number): {
    agreed: boolean;
    synthesized: Partial<DeliberationResult>;
  } {
    const peerMessages = transcript.filter((m) => m.role === 'peer');
    const latestPeer = peerMessages[peerMessages.length - 1];

    if (!latestPeer) {
      return { agreed: false, synthesized: {} };
    }

    const content = latestPeer.content.toLowerCase();
    this.state.peerPosition = latestPeer.content;

    // Score agreement/disagreement signals
    let roundScore = 0;

    for (const signal of AGREEMENT_SIGNALS) {
      if (content.includes(signal)) {
        roundScore += 1;
        break; // Count at most one agreement signal per response
      }
    }

    for (const signal of DISAGREEMENT_SIGNALS) {
      if (content.includes(signal)) {
        roundScore -= 1;
        // Extract the disagreement context
        const idx = content.indexOf(signal);
        const snippet = latestPeer.content.slice(idx, idx + 150).split('\n')[0] ?? '';
        if (snippet && !this.state.keyDisagreements.includes(snippet)) {
          this.state.keyDisagreements.push(snippet);
        }
        break;
      }
    }

    // Proposal stability: compare with previous peer response
    if (this.state.previousPeerContent) {
      const overlap = this.computeKeyTermOverlap(
        this.state.previousPeerContent,
        content,
      );
      if (overlap > 0.5) {
        roundScore += 0.5;
        // Update stable proposal to the converging content
        this.state.stableProposal = latestPeer.content;
      }
    }

    this.state.previousPeerContent = content;
    this.state.score += roundScore;

    // If no stable proposal yet, use the latest peer content
    if (!this.state.stableProposal) {
      this.state.stableProposal = latestPeer.content;
    }

    const agreed = this.state.score >= 1.0;

    if (agreed) {
      return {
        agreed: true,
        synthesized: {
          agreed: true,
          decision: latestPeer.content,
          recommendedPath: latestPeer.content,
          peerPosition: latestPeer.content,
          keyDisagreements: [],
          summary: this.buildSummary(transcript, round, true),
        },
      };
    }

    return {
      agreed: false,
      synthesized: {
        agreed: false,
        recommendedPath: this.state.stableProposal,
        peerPosition: this.state.peerPosition,
        keyDisagreements: this.state.keyDisagreements.slice(0, 5),
        summary: this.buildSummary(transcript, round, false),
      },
    };
  }

  private computeKeyTermOverlap(prev: string, curr: string): number {
    const prevTerms = this.extractKeyTerms(prev);
    const currTerms = this.extractKeyTerms(curr);

    if (prevTerms.size === 0 || currTerms.size === 0) return 0;

    let overlap = 0;
    for (const term of prevTerms) {
      if (currTerms.has(term)) overlap++;
    }

    const unionSize = new Set([...prevTerms, ...currTerms]).size;
    return unionSize > 0 ? overlap / unionSize : 0;
  }

  private extractKeyTerms(text: string): Set<string> {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
      'on', 'with', 'at', 'by', 'from', 'this', 'that', 'it', 'and', 'or',
      'but', 'not', 'if', 'then', 'so', 'we', 'i', 'you', 'they', 'he',
      'she', 'my', 'your', 'our', 'their', 'as', 'up', 'out', 'about',
    ]);

    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));

    return new Set(words);
  }

  private buildSummary(
    transcript: DeliberationMessage[],
    rounds: number,
    agreed: boolean,
  ): string {
    const peerMessages = transcript.filter((m) => m.role === 'peer');
    const roundCount = rounds;

    if (agreed) {
      return `After ${roundCount} round${roundCount === 1 ? '' : 's'} of deliberation, the orchestrator and peer reached agreement.`;
    }

    const disagreementList = this.state.keyDisagreements.length > 0
      ? ` Key areas of disagreement: ${this.state.keyDisagreements.slice(0, 3).join('; ')}.`
      : '';

    return `After ${roundCount} round${roundCount === 1 ? '' : 's'} of deliberation, no clear agreement was reached.${disagreementList}`;
  }

  reset(): void {
    this.state = {
      score: 0,
      stableProposal: null,
      previousPeerContent: null,
      peerPosition: '',
      keyDisagreements: [],
    };
  }
}
