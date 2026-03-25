export type ModelSource = 'cli' | 'env' | 'codex-default';
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';
export type FileStrategy = 'auto' | 'inline' | 'reference';

export interface RuntimeConfig {
  model?: string;
  modelSource: ModelSource;
  reasoningEffort?: ReasoningEffort;
  timeout: number;
  contextBudget: number;
  codexBin: string;
  verbose: boolean;
  traceDir?: string;
  showPeerCommand: boolean;
  showPeerOutput: boolean;
  fileStrategy: FileStrategy;
  retryOnTimeout: boolean;
  persistSession: boolean;
}

export interface ResolveRuntimeConfigInput {
  argv: Record<string, string | boolean | undefined>;
  env?: Record<string, string | undefined>;
}

const VALID_REASONING_EFFORTS = new Set<string>(['low', 'medium', 'high', 'xhigh']);
const VALID_FILE_STRATEGIES = new Set<string>(['auto', 'inline', 'reference']);

function parseNumber(value: string | boolean | undefined, fallback: number): number {
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function envWithFallback(
  env: Record<string, string | undefined>,
  newKey: string,
  oldKey: string,
): string | undefined {
  const newVal = env[newKey];
  if (newVal !== undefined) return newVal;
  const oldVal = env[oldKey];
  if (oldVal !== undefined) {
    process.stderr.write(
      `[opinionate] Warning: ${oldKey} is deprecated; use ${newKey} instead.\n`,
    );
    return oldVal;
  }
  return undefined;
}

export function resolveRuntimeConfig(input: ResolveRuntimeConfigInput & { userConfig?: { reasoningEffort?: string } }): RuntimeConfig {
  const env = input.env ?? {};
  const cliModel = typeof input.argv.model === 'string' ? input.argv.model : undefined;
  const envModel = envWithFallback(env, 'OPINIONATE_MODEL', 'AGENT_DELIBERATE_MODEL');
  const model = cliModel ?? envModel;
  const rawReasoningEffort =
    typeof input.argv['reasoning-effort'] === 'string'
      ? input.argv['reasoning-effort']
      : undefined;
  const rawEnvReasoningEffort = envWithFallback(
    env,
    'OPINIONATE_REASONING_EFFORT',
    'AGENT_DELIBERATE_REASONING_EFFORT',
  );
  const cliReasoningEffort =
    rawReasoningEffort && VALID_REASONING_EFFORTS.has(rawReasoningEffort)
      ? rawReasoningEffort as ReasoningEffort
      : undefined;
  const envReasoningEffort =
    rawEnvReasoningEffort && VALID_REASONING_EFFORTS.has(rawEnvReasoningEffort)
      ? rawEnvReasoningEffort as ReasoningEffort
      : undefined;
  const rawFileStrategy =
    typeof input.argv['file-strategy'] === 'string'
      ? input.argv['file-strategy']
      : undefined;
  const fileStrategy: FileStrategy =
    rawFileStrategy && VALID_FILE_STRATEGIES.has(rawFileStrategy)
      ? rawFileStrategy as FileStrategy
      : 'auto';

  return {
    model,
    modelSource: cliModel ? 'cli' : envModel ? 'env' : 'codex-default',
    reasoningEffort: cliReasoningEffort ?? envReasoningEffort ?? (
      input.userConfig?.reasoningEffort && VALID_REASONING_EFFORTS.has(input.userConfig.reasoningEffort)
        ? input.userConfig.reasoningEffort as ReasoningEffort
        : undefined
    ),
    timeout: parseNumber(input.argv.timeout, parseNumber(envWithFallback(env, 'OPINIONATE_TIMEOUT', 'AGENT_DELIBERATE_TIMEOUT'), 60_000)),
    contextBudget: parseNumber(
      input.argv['context-budget'],
      parseNumber(envWithFallback(env, 'OPINIONATE_CONTEXT_BUDGET', 'AGENT_DELIBERATE_CONTEXT_BUDGET'), 50_000),
    ),
    codexBin:
      (typeof input.argv['codex-bin'] === 'string' && input.argv['codex-bin']) ||
      envWithFallback(env, 'OPINIONATE_CODEX_BIN', 'AGENT_DELIBERATE_CODEX_BIN') ||
      'codex',
    verbose: input.argv.verbose === true,
    traceDir: typeof input.argv['trace-dir'] === 'string' ? input.argv['trace-dir'] : undefined,
    showPeerCommand: input.argv['show-peer-command'] === true,
    showPeerOutput: input.argv['show-peer-output'] === true,
    fileStrategy,
    retryOnTimeout: input.argv['retry-on-timeout'] === true,
    persistSession: input.argv['persist-session'] === true,
  };
}
