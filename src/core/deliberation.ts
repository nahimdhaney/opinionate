import type {
  Adapter,
  DeliberationConfig,
  DeliberationContext,
  DeliberationMessage,
  DeliberationMode,
  DeliberationResult,
  DeliberationSessionMemory,
} from './types.js';
import { DeliberationError, DEFAULT_CONFIG } from './types.js';
import { ContextBuilder } from './context-builder.js';
import { AgreementDetector } from './agreement-detector.js';
import {
  extractSessionMemoryFromContent,
  synthesizeSessionMemoryFromResult,
} from './session-memory.js';

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
  private partialRounds: number[] = [];
  private latestSessionMemory?: DeliberationSessionMemory;

  constructor(config: DeliberationConfig) {
    this.config = {
      ...config,
      maxRounds: config.maxRounds ?? DEFAULT_CONFIG.maxRounds,
      timeout: config.timeout ?? DEFAULT_CONFIG.timeout,
      contextBudget: config.contextBudget ?? DEFAULT_CONFIG.contextBudget,
      retryOnTimeout: config.retryOnTimeout ?? false,
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
        const roundStartedAt = Date.now();
        this.config.onRoundStart?.(round);

        // Record orchestrator message
        this.addMessage('orchestrator', orchestratorPrompt, round);

        // Build full payload with context for the peer
        let roundContext = { ...context };
        let payload = this.contextBuilder.buildPromptPayload(
          orchestratorPrompt,
          roundContext,
          this.transcript,
          round,
        );
        this.config.onVerbose?.(
          `Round ${round}: prompt payload size: ${(Buffer.byteLength(payload, 'utf-8') / 1024).toFixed(1)}KB (budget: ${(this.config.contextBudget / 1024).toFixed(0)}KB)`,
        );

        // Send to peer
        let peerResponse: string;
        let roundTimeout = this.config.timeout;
        let retried = false;
        try {
          while (true) {
            try {
              const raw = await peerAdapter.sendMessage(payload, roundContext, {
                timeoutMs: roundTimeout,
              });
              const isPartial = typeof raw === 'object' && raw.partial;
              const extracted = extractSessionMemoryFromContent(
                typeof raw === 'string' ? raw : raw.content,
              );
              peerResponse = extracted.cleanContent;
              if (extracted.memory) {
                this.latestSessionMemory = extracted.memory;
              }

              if (isPartial) {
                this.partialRounds.push(round);
                this.config.onVerbose?.(
                  `Round ${round}: peer timed out but returned partial response (${peerResponse.length} chars)`,
                );
              }
              break;
            } catch (err) {
              if (
                err instanceof DeliberationError &&
                err.code === 'ADAPTER_TIMEOUT' &&
                this.config.retryOnTimeout &&
                !retried
              ) {
                retried = true;
                roundTimeout = Math.round(roundTimeout * 1.5);
                roundContext = { ...context, fileStrategy: 'reference' };
                payload = this.contextBuilder.buildPromptPayload(
                  orchestratorPrompt,
                  roundContext,
                  this.transcript,
                  round,
                );
                this.config.onVerbose?.(
                  `Round ${round}: timed out. Retrying with reference-only file context and timeout ${roundTimeout}ms`,
                );
                continue;
              }

              throw err;
            }
          }
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
        this.config.onRoundComplete?.(round, [...this.transcript], {
          durationMs: Date.now() - roundStartedAt,
          agreed,
        });

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
    let prompt: string;

    // If orchestratorAdapter is provided, use it to generate prompts
    if (orchestratorAdapter) {
      const promptContext = peerResponse
        ? `Generate a follow-up deliberation prompt for round ${round}. Mode: ${mode}. Task: ${context.task}. The peer's previous response was:\n\n${peerResponse}\n\nBuild on their input, challenge weak points, and drive toward convergence.`
        : `Generate an opening deliberation prompt. Mode: ${mode}. Task: ${context.task}. Start the ${mode} discussion.`;

      const raw = await orchestratorAdapter.sendMessage(promptContext, context);
      prompt = typeof raw === 'string' ? raw : raw.content;
      return this.appendSessionMemoryRequest(
        this.ensureTerminalVerdictRequest(prompt, round, peerResponse),
        context,
      );
    }

    // Template-based orchestrator (v1 default)
    const templates = MODE_TEMPLATES[mode];

    if (!peerResponse) {
      // Opening prompt
      prompt = templates.opening
        .replace('{task}', context.task)
        .replace('{context}', this.buildInlineContext(context));
      return this.appendSessionMemoryRequest(
        this.ensureTerminalVerdictRequest(prompt, round, peerResponse),
        context,
      );
    }

    // Follow-up prompt
    const refinement = this.buildRefinement(peerResponse, round);
    prompt = templates.followUp
      .replace('{peerResponse}', peerResponse)
      .replace('{refinement}', refinement)
      .replace('{task}', context.task)
      .replace('{context}', this.buildInlineContext(context));
    return this.appendSessionMemoryRequest(
      this.ensureTerminalVerdictRequest(prompt, round, peerResponse),
      context,
    );
  }

  private buildTerminalVerdictInstruction(): string {
    return 'Please structure your final response as:\n**Verdict:** AGREE or DISAGREE\n**Decision:** [one-sentence summary of the best path]\n**Details:** [your supporting reasoning]';
  }

  private ensureTerminalVerdictRequest(
    prompt: string,
    round: number,
    peerResponse: string | null,
  ): string {
    if (round < this.config.maxRounds || prompt.includes('**Verdict:**')) {
      return prompt;
    }

    const prelude = peerResponse
      ? 'This is our final round. Let us settle on the best path forward given everything discussed.'
      : 'This is the only round. Please settle on the best path forward given the current context.';

    return `${prompt}\n\n${prelude}\n\n${this.buildTerminalVerdictInstruction()}`;
  }

  private buildRefinement(peerResponse: string, round: number): string {
    // Template-based refinements that push toward convergence
    if (round <= 2) {
      return 'Let me build on your points and suggest a combined approach.';
    }
    if (round <= 4) {
      if (round >= this.config.maxRounds) {
        return `This is our final round. Let us settle on the best path forward given everything discussed.\n\n${this.buildTerminalVerdictInstruction()}`;
      }
      return 'We should converge on a direction. Here is what I think we both agree on so far.';
    }
    return `This is our final round. Let us settle on the best path forward given everything discussed.\n\n${this.buildTerminalVerdictInstruction()}`;
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

  private appendSessionMemoryRequest(prompt: string, context: DeliberationContext): string {
    if (!context.persistSession && !context.sessionId) {
      return prompt;
    }

    return `${prompt}\n\nAt the end of your response, append exactly one machine-readable block in this format:\n<opinionate-session-memory>\n{"acceptedDecisions":["..."],"rejectedIdeas":["..."],"openQuestions":["..."],"latestRecommendation":"...","latestPeerPosition":"..."}\n</opinionate-session-memory>\nUse empty arrays if needed.`;
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
    const baseResult: DeliberationResult = {
      agreed: synthesized.agreed ?? false,
      summary: synthesized.summary ?? '',
      decision: synthesized.decision,
      recommendedPath: synthesized.recommendedPath ?? '',
      peerPosition: synthesized.peerPosition ?? '',
      keyDisagreements: synthesized.keyDisagreements ?? [],
      transcript: [...this.transcript],
      rounds,
      partialRounds: this.partialRounds.length > 0 ? [...this.partialRounds] : undefined,
      sessionId: this.config.context.sessionId,
    };

    if (this.config.context.persistSession || this.config.context.sessionId) {
      baseResult.sessionMemory = synthesizeSessionMemoryFromResult(
        baseResult,
        this.latestSessionMemory,
      );
    }

    return baseResult;
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
