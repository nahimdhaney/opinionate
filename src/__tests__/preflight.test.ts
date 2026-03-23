import { describe, expect, it } from 'vitest';
import { formatDoctorResult, runDoctor } from '../core/preflight.js';

describe('runDoctor', () => {
  it('reports missing codex and missing skill installation with actionable guidance', async () => {
    const result = await runDoctor({
      cwd: '/tmp/project',
      runtimeConfig: {
        model: undefined,
        modelSource: 'codex-default',
        timeout: 60000,
        contextBudget: 50000,
        codexBin: 'codex',
        verbose: false,
        showPeerCommand: false,
        showPeerOutput: false,
        fileStrategy: 'auto',
        retryOnTimeout: false,
      },
      codexInfo: null,
      skillInstalled: false,
      linkedBinaryPath: null,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Codex CLI not found'),
        expect.stringContaining('.claude/skills/opinionate/SKILL.md'),
      ]),
    );
  });

  it('reports installed-but-unauthenticated codex separately from missing binary', async () => {
    const result = await runDoctor({
      cwd: '/tmp/project',
      runtimeConfig: {
        model: undefined,
        modelSource: 'codex-default',
        timeout: 60000,
        contextBudget: 50000,
        codexBin: 'codex',
        verbose: false,
        showPeerCommand: false,
        showPeerOutput: false,
        fileStrategy: 'auto',
        retryOnTimeout: false,
      },
      codexInfo: {
        version: '0.116.0',
        rawVersion: 'codex-cli 0.116.0',
        supportsExec: true,
        supportsModelFlag: true,
        supportsConfigFlag: true,
      },
      codexAuth: { ok: false, reason: 'not_authenticated', detail: 'Run codex login.' },
      skillInstalled: true,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.stringContaining('codex login')]),
    );
  });

  it('reports explicit model overrides in the doctor result', async () => {
    const result = await runDoctor({
      cwd: '/tmp/project',
      runtimeConfig: {
        model: 'gpt-5.4',
        modelSource: 'cli',
        timeout: 60000,
        contextBudget: 50000,
        codexBin: 'codex',
        verbose: false,
        showPeerCommand: false,
        showPeerOutput: false,
        fileStrategy: 'auto',
        retryOnTimeout: false,
      },
      codexInfo: {
        version: '0.116.0',
        rawVersion: 'codex-cli 0.116.0',
        supportsExec: true,
        supportsModelFlag: true,
        supportsConfigFlag: true,
      },
      codexAuth: { ok: true },
      skillInstalled: true,
      linkedBinaryPath: '/usr/local/bin/opinionate',
    });

    expect(result.ok).toBe(true);
    expect(result.modelSource).toBe('cli');
    expect(result.suggestions).toEqual(
      expect.arrayContaining([expect.stringContaining('explicit override')]),
    );
  });

  it('reports configured codex reasoning effort and warns on xhigh', async () => {
    const result = await runDoctor({
      cwd: '/tmp/project',
      runtimeConfig: {
        model: undefined,
        modelSource: 'codex-default',
        timeout: 60000,
        contextBudget: 50000,
        codexBin: 'codex',
        verbose: false,
        showPeerCommand: false,
        showPeerOutput: false,
        fileStrategy: 'auto',
        retryOnTimeout: false,
      },
      codexInfo: {
        version: '0.116.0',
        rawVersion: 'codex-cli 0.116.0',
        supportsExec: true,
        supportsModelFlag: true,
        supportsConfigFlag: true,
      },
      codexAuth: { ok: true },
      skillInstalled: true,
      linkedBinaryPath: '/usr/local/bin/opinionate',
      readConfig: () => ({
        path: '/Users/test/.codex/config.toml',
        reasoningEffort: 'xhigh',
      }),
    });

    expect(result.codexConfig?.reasoningEffort).toBe('xhigh');
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('consider --reasoning-effort medium')]),
    );
    expect(formatDoctorResult(result)).toContain('Codex reasoning effort: xhigh');
  });
});
