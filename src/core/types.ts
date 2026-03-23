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
}

export interface DeliberationConfig {
  maxRounds: number;
  timeout: number;
  mode: DeliberationMode;
  peerAdapter: Adapter;
  orchestratorAdapter?: Adapter;
  context: DeliberationContext;
  contextBudget: number;
  onRoundComplete?: (round: number, transcript: DeliberationMessage[]) => void;
}

export type DeliberationMode = 'plan' | 'review' | 'debug' | 'decide';

export interface DeliberationContext {
  task: string;
  files?: FileContext[];
  gitLog?: string;
  conversationSummary?: string;
  cwd?: string;
}

export interface FileContext {
  path: string;
  content: string;
}

export interface Adapter {
  name: string;
  initialize(): Promise<void>;
  sendMessage(prompt: string, context: DeliberationContext): Promise<string>;
  isAvailable(): Promise<boolean>;
  cleanup(): Promise<void>;
}

export type DeliberationErrorCode =
  | 'ADAPTER_UNAVAILABLE'
  | 'ADAPTER_TIMEOUT'
  | 'ADAPTER_ERROR'
  | 'MAX_ROUNDS_EXCEEDED';

export class DeliberationError extends Error {
  public code: DeliberationErrorCode;
  public round?: number;

  constructor(message: string, code: DeliberationErrorCode, round?: number) {
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
