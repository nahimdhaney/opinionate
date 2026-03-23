import { relative } from 'node:path';
import type { DeliberationContext, DeliberationMessage, FileContext } from './types.js';
import { IgnoreMatcher, loadIgnoreRules } from '../util/ignore.js';

export class ContextBuilder {
  private budget: number;
  private cwd: string;
  private ignoreMatcher: IgnoreMatcher;

  constructor(budget: number, cwd?: string) {
    this.budget = budget;
    this.cwd = cwd ?? process.cwd();
    this.ignoreMatcher = loadIgnoreRules(this.cwd);
  }

  buildPromptPayload(
    prompt: string,
    context: DeliberationContext,
    transcript: DeliberationMessage[],
    round: number,
  ): string {
    const transcriptText = this.formatTranscript(transcript);
    const transcriptSize = Buffer.byteLength(transcriptText, 'utf-8');

    // Budget split: transcript capped at 60%, static context gets the rest
    const maxTranscriptBudget = Math.floor(this.budget * 0.6);
    const actualTranscriptSize = Math.min(transcriptSize, maxTranscriptBudget);
    const staticBudget = this.budget - actualTranscriptSize;

    const parts: string[] = [];

    // Task
    parts.push(`## Task\n${context.task}`);

    // Prompt
    parts.push(`## Current Prompt\n${prompt}`);

    // Static context (files, git, conversation summary) — fitted to remaining budget
    const staticParts = this.buildStaticContext(context, staticBudget);
    if (staticParts) {
      parts.push(staticParts);
    }

    // Transcript (summarized if over budget)
    if (round > 1 && transcript.length > 0) {
      const fittedTranscript =
        transcriptSize > maxTranscriptBudget
          ? this.summarizeTranscript(transcript, maxTranscriptBudget)
          : transcriptText;
      parts.push(`## Deliberation History\n${fittedTranscript}`);
    }

    return parts.join('\n\n');
  }

  filterFiles(files: FileContext[]): FileContext[] {
    return files.filter((f) => {
      const rel = relative(this.cwd, f.path) || f.path;
      return !this.ignoreMatcher.isIgnored(rel);
    });
  }

  private buildStaticContext(context: DeliberationContext, budget: number): string | null {
    const parts: string[] = [];
    let remaining = budget;

    // Conversation summary first (usually small, high value)
    if (context.conversationSummary) {
      const summary = `## Conversation Context\n${context.conversationSummary}`;
      const size = Buffer.byteLength(summary, 'utf-8');
      if (size <= remaining) {
        parts.push(summary);
        remaining -= size;
      }
    }

    // Git log
    if (context.gitLog) {
      const trimmedLog = this.trimGitLog(context.gitLog, 20);
      const gitSection = `## Recent Git History\n${trimmedLog}`;
      const size = Buffer.byteLength(gitSection, 'utf-8');
      if (size <= remaining) {
        parts.push(gitSection);
        remaining -= size;
      }
    }

    // Files — filter unsafe, then fit to budget
    if (context.files && context.files.length > 0) {
      const safeFiles = this.filterFiles(context.files);
      const fileSection = this.fitFilesToBudget(safeFiles, remaining);
      if (fileSection) {
        parts.push(fileSection);
      }
    }

    return parts.length > 0 ? parts.join('\n\n') : null;
  }

  private fitFilesToBudget(files: FileContext[], budget: number): string | null {
    const parts: string[] = ['## Relevant Files'];
    let remaining = budget - Buffer.byteLength('## Relevant Files\n', 'utf-8');

    for (const file of files) {
      const fileBlock = `\n### ${file.path}\n\`\`\`\n${file.content}\n\`\`\``;
      const size = Buffer.byteLength(fileBlock, 'utf-8');

      if (size <= remaining) {
        parts.push(fileBlock);
        remaining -= size;
      } else if (remaining > 200) {
        // Truncate this file to fit
        const header = `\n### ${file.path}\n\`\`\`\n`;
        const footer = '\n[truncated]\n```';
        const headerFooterSize = Buffer.byteLength(header + footer, 'utf-8');
        const contentBudget = remaining - headerFooterSize;
        if (contentBudget > 100) {
          const truncated = file.content.slice(0, contentBudget);
          parts.push(`${header}${truncated}${footer}`);
          remaining = 0;
        }
        break;
      } else {
        break;
      }
    }

    return parts.length > 1 ? parts.join('') : null;
  }

  private formatTranscript(transcript: DeliberationMessage[]): string {
    if (transcript.length === 0) return '';

    return transcript
      .map(
        (msg) =>
          `**Round ${msg.round} — ${msg.role === 'orchestrator' ? 'Orchestrator' : 'Peer'}:**\n${msg.content}`,
      )
      .join('\n\n');
  }

  private summarizeTranscript(
    transcript: DeliberationMessage[],
    maxBytes: number,
  ): string {
    if (transcript.length <= 4) {
      // 2 rounds or less — just truncate content
      return this.formatTranscript(transcript).slice(0, maxBytes);
    }

    // Keep last 2 full rounds (4 messages), summarize the rest
    const lastRound = transcript[transcript.length - 1]!.round;
    const keepFromRound = lastRound - 1;

    const olderMessages = transcript.filter((m) => m.round < keepFromRound);
    const recentMessages = transcript.filter((m) => m.round >= keepFromRound);

    const summaryHeader = `[Rounds 1-${keepFromRound - 1} summarized]: The deliberation covered `;
    const topics = this.extractTopics(olderMessages);
    const olderSummary = `${summaryHeader}${topics}.\n\n`;

    const recentText = this.formatTranscript(recentMessages);
    const totalText = olderSummary + recentText;

    if (Buffer.byteLength(totalText, 'utf-8') <= maxBytes) {
      return totalText;
    }

    return totalText.slice(0, maxBytes);
  }

  private extractTopics(messages: DeliberationMessage[]): string {
    const peerMessages = messages.filter((m) => m.role === 'peer');
    if (peerMessages.length === 0) return 'initial proposals and counterpoints';

    const topics = peerMessages
      .map((m) => {
        const firstSentence = m.content.split(/[.!?]\s/)[0];
        return firstSentence?.slice(0, 100) ?? '';
      })
      .filter(Boolean);

    return topics.join('; ') || 'various approaches and trade-offs';
  }

  private trimGitLog(log: string, maxCommits: number): string {
    const lines = log.split('\n');
    let commitCount = 0;
    const result: string[] = [];

    for (const line of lines) {
      if (line.startsWith('commit ')) {
        commitCount++;
        if (commitCount > maxCommits) break;
      }
      result.push(line);
    }

    return result.join('\n');
  }
}
