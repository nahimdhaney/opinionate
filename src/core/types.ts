export interface DeliberationMessage {
  role: 'orchestrator' | 'peer';
  content: string;
  round: number;
  timestamp: number;
}

export interface DeliberationResult {
  agreed: boolean;
  summary: string;
  decision?: string;
  recommendedPath: string;
  peerPosition: string;
  keyDisagreements: string[];
  transcript: DeliberationMessage[];
  rounds: number;
  partialRounds?: number[];
  sessionId?: string;
  persistedSession?: boolean;
  continuedFromSession?: boolean;
  sessionMemory?: DeliberationSessionMemory;
}

export interface DeliberationConfig {
  maxRounds: number;
  timeout: number;
  mode: DeliberationMode;
  peerAdapter: Adapter;
  orchestratorAdapter?: Adapter;
  context: DeliberationContext;
  contextBudget: number;
  retryOnTimeout?: boolean;
  onRoundStart?: (round: number) => void;
  onRoundComplete?: (round: number, transcript: DeliberationMessage[], roundResult?: { durationMs: number; agreed: boolean }) => void;
  onVerbose?: (message: string) => void;
}

export type DeliberationMode = 'plan' | 'review' | 'debug' | 'decide';
export type FileStrategy = 'auto' | 'inline' | 'reference';

export interface DeliberationContext {
  task: string;
  files?: FileContext[];
  gitLog?: string;
  conversationSummary?: string;
  cwd?: string;
  fileStrategy?: FileStrategy;
  persistSession?: boolean;
  sessionId?: string;
  resumeMemory?: DeliberationSessionMemory;
  fileDeltas?: FileDelta[];
}

export interface FileContext {
  path: string;
  content?: string;
  sizeBytes?: number;
}

export interface FileDelta {
  path: string;
  status: 'added' | 'changed' | 'removed' | 'unchanged';
  summary: string;
  diff?: string;
  changedLineCount: number;
}

export interface DeliberationSessionMemory {
  summary: string;
  acceptedDecisions: string[];
  rejectedIdeas: string[];
  openQuestions: string[];
  latestRecommendation?: string;
  latestPeerPosition?: string;
  source: 'structured' | 'heuristic';
}

export interface AdapterCallOptions {
  timeoutMs?: number;
  logicalRound?: number;
  attempt?: number;
}

export interface Adapter {
  name: string;
  initialize(): Promise<void>;
  sendMessage(
    prompt: string,
    context: DeliberationContext,
    options?: AdapterCallOptions,
  ): Promise<string | AdapterResponse>;
  isAvailable(): Promise<boolean>;
  cleanup(): Promise<void>;
}

export type DeliberationErrorCode =
  | 'ADAPTER_UNAVAILABLE'
  | 'ADAPTER_TIMEOUT'
  | 'ADAPTER_ERROR'
  | 'MAX_ROUNDS_EXCEEDED';

export interface AdapterResponse {
  content: string;
  partial: boolean;
  signal?: NodeJS.Signals | null;
  durationMs: number;
}

export class DeliberationError extends Error {
  public code: DeliberationErrorCode;
  public round?: number;

  constructor(
    message: string,
    code: DeliberationErrorCode,
    round?: number,
  ) {
    super(message);
    this.name = 'DeliberationError';
    this.code = code;
    this.round = round;
  }
}

export const DEFAULT_CONFIG = {
  maxRounds: 5,
  timeout: 60_000,
  contextBudget: 50_000,
} as const;
