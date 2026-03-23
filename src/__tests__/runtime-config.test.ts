import { describe, expect, it } from 'vitest';
import { resolveRuntimeConfig } from '../core/runtime-config.js';

describe('resolveRuntimeConfig', () => {
  it('prefers explicit cli flags over env and defaults', () => {
    const resolved = resolveRuntimeConfig({
      argv: {
        model: 'gpt-5.4',
        timeout: '30000',
        'context-budget': '64000',
        'codex-bin': '/tmp/codex',
        verbose: true,
      },
      env: {
        OPINIONATE_MODEL: 'o4-mini',
        OPINIONATE_TIMEOUT: '70000',
      },
    });

    expect(resolved.model).toBe('gpt-5.4');
    expect(resolved.modelSource).toBe('cli');
    expect(resolved.timeout).toBe(30000);
    expect(resolved.contextBudget).toBe(64000);
    expect(resolved.codexBin).toBe('/tmp/codex');
    expect(resolved.verbose).toBe(true);
  });

  it('omits model override when none is provided so codex default is preserved', () => {
    const resolved = resolveRuntimeConfig({ argv: {}, env: {} });

    expect(resolved.model).toBeUndefined();
    expect(resolved.modelSource).toBe('codex-default');
    expect(resolved.timeout).toBe(60000);
    expect(resolved.contextBudget).toBe(50000);
    expect(resolved.codexBin).toBe('codex');
    expect(resolved.showPeerCommand).toBe(false);
    expect(resolved.showPeerOutput).toBe(false);
  });

  it('uses env fallback when cli flag is absent', () => {
    const resolved = resolveRuntimeConfig({
      argv: {},
      env: {
        OPINIONATE_MODEL: 'gpt-5.4',
        OPINIONATE_TIMEOUT: '45000',
        OPINIONATE_CONTEXT_BUDGET: '70000',
        OPINIONATE_CODEX_BIN: '/usr/local/bin/codex',
      },
    });

    expect(resolved.model).toBe('gpt-5.4');
    expect(resolved.modelSource).toBe('env');
    expect(resolved.timeout).toBe(45000);
    expect(resolved.contextBudget).toBe(70000);
    expect(resolved.codexBin).toBe('/usr/local/bin/codex');
  });

  it('falls back to deprecated AGENT_DELIBERATE_* env vars', () => {
    const resolved = resolveRuntimeConfig({
      argv: {},
      env: {
        AGENT_DELIBERATE_MODEL: 'gpt-5.4',
        AGENT_DELIBERATE_TIMEOUT: '45000',
        AGENT_DELIBERATE_CONTEXT_BUDGET: '70000',
        AGENT_DELIBERATE_CODEX_BIN: '/usr/local/bin/codex',
      },
    });

    expect(resolved.model).toBe('gpt-5.4');
    expect(resolved.modelSource).toBe('env');
    expect(resolved.timeout).toBe(45000);
    expect(resolved.contextBudget).toBe(70000);
    expect(resolved.codexBin).toBe('/usr/local/bin/codex');
  });

  it('prefers new OPINIONATE_* env vars over deprecated AGENT_DELIBERATE_*', () => {
    const resolved = resolveRuntimeConfig({
      argv: {},
      env: {
        OPINIONATE_MODEL: 'new-model',
        AGENT_DELIBERATE_MODEL: 'old-model',
      },
    });

    expect(resolved.model).toBe('new-model');
  });
});
