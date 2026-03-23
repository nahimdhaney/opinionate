import type {
  Adapter,
  DeliberationConfig,
  DeliberationContext,
  DeliberationMessage,
  DeliberationMode,
  DeliberationResult,
} from './types.js';
import { DeliberationError, DEFAULT_CONFIG } from './types.js';
import { ContextBuilder } from './context-builder.js';
import { AgreementDetector } from './agreement-detector.js';

const MODE_TEMPLATES: Record<DeliberationMode, { opening: string; followUp: string }> = {
  plan: {
    opening:
      'We need to plan the following task: {task}\n\nHere is the relevant context:\n\n{context}\n\nWhat is your recommended approach? Consider architecture, trade-offs, and implementation strategy.',
    followUp:
      'Thank you for your input. Here is what you proposed:\n\n{peerResponse}\n\nLet me consider this and refine. {refinement}\n\nDo you agree with this direction, or do you see issues we should address?',
  },
  review: {
    opening:
      'Please review the following implementation:\n\n{context}\n\nTask context: {task}\n\nWhat issues do you see? What would you improve? Be specific about code quality, correctness, and maintainability.',
    followUp:
      'You raised these points:\n\n{peerResponse}\n\n{refinement}\n\nAre there any remaining concerns, or does this address the issues adequately?',
  },
  debug: {
    opening:
      'We are stuck on the following problem: {task}\n\nHere is what we know:\n\n{context}\n\nWhat could be causing this? Suggest concrete debugging steps or hypotheses.',
    followUp:
      'You suggested:\n\n{peerResponse}\n\n{refinement}\n\nDo you think we have identified the root cause, or should we investigate further?',
  },
  decide: {
    opening:
      'We need to make a technical decision: {task}\n\nContext:\n\n{context}\n\nWhat is your recommendation and why? Consider trade-offs, risks, and long-term implications.',
    followUp:
      'Your recommendation was:\n\n{peerResponse}\n\n{refinement}\n\nAre we aligned on this decision, or do you see reasons to reconsider?',
  },
};

export class Deliberation {
  private config: Required<Pick<DeliberationConfig, 'maxRounds' | 'timeout' | 'contextBudget'>> &
    DeliberationConfig;
  private contextBuilder: ContextBuilder;
  private agreementDetector: AgreementDetector;
  private transcript: DeliberationMessage[] = [];
  private currentRound = 0;

  constructor(config: DeliberationConfig) {
    this.config = {
      ...config,
      maxRounds: config.maxRounds ?? DEFAULT_CONFIG.maxRounds,
      timeout: config.timeout ?? DEFAULT_CONFIG.timeout,
      contextBudget: config.contextBudget ?? DEFAULT_CONFIG.contextBudget,
    };
    this.contextBuilder = new ContextBuilder(this.config.contextBudget, config.context.cwd);
    this.agreementDetector = new AgreementDetector();
  }

  async run(): Promise<DeliberationResult> {
    const { peerAdapter, orchestratorAdapter, context, mode, maxRounds } = this.config;

    // Validate adapter availability
    await this.validateAdapter(peerAdapter);
    if (orchestratorAdapter) {
      await this.validateAdapter(orchestratorAdapter);
    }

    try {
      // Generate opening prompt
      let orchestratorPrompt = await this.generateOrchestratorPrompt(
        mode,
        context,
        null,
        1,
      );

      for (let round = 1; round <= maxRounds; round++) {
        this.currentRound = round;

        // Record orchestrator message
        this.addMessage('orchestrator', orchestratorPrompt, round);

        // Build full payload with context for the peer
        const payload = this.contextBuilder.buildPromptPayload(
          orchestratorPrompt,
          context,
          this.transcript,
          round,
        );

        // Send to peer
        let peerResponse: string;
        try {
          peerResponse = await peerAdapter.sendMessage(payload, context);
        } catch (err) {
          if (err instanceof DeliberationError) throw err;
          throw new DeliberationError(
            `Peer adapter error in round ${round}: ${err instanceof Error ? err.message : String(err)}`,
            'ADAPTER_ERROR',
            round,
          );
        }

        // Record peer message
        this.addMessage('peer', peerResponse, round);

        // Check agreement
        const { agreed, synthesized } = this.agreementDetector.evaluate(
          this.transcript,
          round,
        );

        // Notify progress
        this.config.onRoundComplete?.(round, [...this.transcript]);

        if (agreed) {
          return this.buildResult(synthesized, round);
        }

        // Generate next orchestrator prompt (if not last round)
        if (round < maxRounds) {
          orchestratorPrompt = await this.generateOrchestratorPrompt(
            mode,
            context,
            peerResponse,
            round + 1,
          );
        }
      }

      // Max rounds reached — return inconclusive result
      const { synthesized } = this.agreementDetector.evaluate(
        this.transcript,
        maxRounds,
      );

      return this.buildResult(
        { ...synthesized, agreed: false },
        maxRounds,
      );
    } finally {
      await peerAdapter.cleanup();
      if (orchestratorAdapter) {
        await orchestratorAdapter.cleanup();
      }
    }
  }

  private async generateOrchestratorPrompt(
    mode: DeliberationMode,
    context: DeliberationContext,
    peerResponse: string | null,
    round: number,
  ): Promise<string> {
    const { orchestratorAdapter } = this.config;

    // If orchestratorAdapter is provided, use it to generate prompts
    if (orchestratorAdapter) {
      const promptContext = peerResponse
        ? `Generate a follow-up deliberation prompt for round ${round}. Mode: ${mode}. Task: ${context.task}. The peer's previous response was:\n\n${peerResponse}\n\nBuild on their input, challenge weak points, and drive toward convergence.`
        : `Generate an opening deliberation prompt. Mode: ${mode}. Task: ${context.task}. Start the ${mode} discussion.`;

      return orchestratorAdapter.sendMessage(promptContext, context);
    }

    // Template-based orchestrator (v1 default)
    const templates = MODE_TEMPLATES[mode];

    if (!peerResponse) {
      // Opening prompt
      return templates.opening
        .replace('{task}', context.task)
        .replace('{context}', this.buildInlineContext(context));
    }

    // Follow-up prompt
    const refinement = this.buildRefinement(peerResponse, round);
    return templates.followUp
      .replace('{peerResponse}', peerResponse)
      .replace('{refinement}', refinement)
      .replace('{task}', context.task)
      .replace('{context}', this.buildInlineContext(context));
  }

  private buildRefinement(peerResponse: string, round: number): string {
    // Template-based refinements that push toward convergence
    if (round <= 2) {
      return 'Let me build on your points and suggest a combined approach.';
    }
    if (round <= 4) {
      return 'We should converge on a direction. Here is what I think we both agree on so far.';
    }
    return 'This is our final round. Let us settle on the best path forward given everything discussed.';
  }

  private buildInlineContext(context: DeliberationContext): string {
    const parts: string[] = [];

    if (context.conversationSummary) {
      parts.push(`Conversation: ${context.conversationSummary}`);
    }

    if (context.files && context.files.length > 0) {
      const safeFiles = this.contextBuilder.filterFiles(context.files);
      const fileList = safeFiles.map((f) => f.path).join(', ');
      parts.push(`Relevant files: ${fileList}`);
    }

    if (context.gitLog) {
      parts.push(`Recent git activity available.`);
    }

    return parts.join('\n') || 'No additional context provided.';
  }

  private addMessage(role: 'orchestrator' | 'peer', content: string, round: number): void {
    this.transcript.push({
      role,
      content,
      round,
      timestamp: Date.now(),
    });
  }

  private buildResult(
    synthesized: Partial<DeliberationResult>,
    rounds: number,
  ): DeliberationResult {
    return {
      agreed: synthesized.agreed ?? false,
      summary: synthesized.summary ?? '',
      decision: synthesized.decision,
      recommendedPath: synthesized.recommendedPath ?? '',
      peerPosition: synthesized.peerPosition ?? '',
      keyDisagreements: synthesized.keyDisagreements ?? [],
      transcript: [...this.transcript],
      rounds,
    };
  }

  private async validateAdapter(adapter: Adapter): Promise<void> {
    const available = await adapter.isAvailable();
    if (!available) {
      throw new DeliberationError(
        `Adapter "${adapter.name}" is not available. Ensure it is installed and accessible.`,
        'ADAPTER_UNAVAILABLE',
      );
    }
    await adapter.initialize();
  }
}
