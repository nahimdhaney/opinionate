export type ModelSource = 'cli' | 'env' | 'codex-default';

export interface RuntimeConfig {
  model?: string;
  modelSource: ModelSource;
  timeout: number;
  contextBudget: number;
  codexBin: string;
  verbose: boolean;
  traceDir?: string;
  showPeerCommand: boolean;
  showPeerOutput: boolean;
}

export interface ResolveRuntimeConfigInput {
  argv: Record<string, string | boolean | undefined>;
  env?: Record<string, string | undefined>;
}

function parseNumber(value: string | boolean | undefined, fallback: number): number {
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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

export function resolveRuntimeConfig(input: ResolveRuntimeConfigInput): RuntimeConfig {
  const env = input.env ?? {};
  const cliModel = typeof input.argv.model === 'string' ? input.argv.model : undefined;
  const envModel = envWithFallback(env, 'OPINIONATE_MODEL', 'AGENT_DELIBERATE_MODEL');
  const model = cliModel ?? envModel;

  return {
    model,
    modelSource: cliModel ? 'cli' : envModel ? 'env' : 'codex-default',
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
  };
}
