import type { Adapter, DeliberationContext } from '../core/types.js';
import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../cli.js';

function createMemoryIO() {
  let stdout = '';
  let stderr = '';

  return {
    io: {
      stdout: (chunk: string) => {
        stdout += chunk;
      },
      stderr: (chunk: string) => {
        stderr += chunk;
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

describe('runCli', () => {
  it('prints doctor output to stderr and exits 0 when environment is ready', async () => {
    const output = createMemoryIO();
    const exitCode = await runCli(['node', 'opinionate', 'doctor'], {
      io: output.io,
      env: {},
      cwd: () => '/tmp/project',
      runDoctor: vi.fn().mockResolvedValue({
        ok: true,
        cwd: '/tmp/project',
        codex: {
          version: '0.116.0',
          rawVersion: 'codex-cli 0.116.0',
          supportsExec: true,
          supportsModelFlag: true,
          supportsConfigFlag: true,
        },
        codexAuth: { ok: true },
        skillInstalled: true,
        skillFile: '/tmp/project/.claude/skills/opinionate/SKILL.md',
        linkedBinaryPath: '/usr/local/bin/opinionate',
        model: undefined,
        modelSource: 'codex-default',
        issues: [],
        suggestions: ['Codex default model will be used.'],
      }),
    });

    expect(exitCode).toBe(0);
    expect(output.stderr()).toContain('Environment ready');
  });

  it('prints the exact codex command and round metadata in verbose mode', async () => {
    const output = createMemoryIO();

    const exitCode = await runCli(
      ['node', 'opinionate', 'run', '--mode', 'review', '--task', 'Check PR', '--verbose', '--show-peer-command'],
      {
        io: output.io,
        env: {},
        cwd: () => '/tmp/project',
        resolveAdapter: (_name, options) => {
          const adapter: Adapter = {
            name: 'fake-codex',
            initialize: vi.fn().mockResolvedValue(undefined),
            isAvailable: vi.fn().mockResolvedValue(true),
            cleanup: vi.fn().mockResolvedValue(undefined),
            sendMessage: vi.fn().mockImplementation(async (_prompt: string, _context: DeliberationContext) => {
              options.trace?.onRoundStart({
                round: 1,
                command: ['codex', 'exec', 'hello'],
                model: options.model,
                modelSource: options.modelSource,
                pid: 321,
                codexInfo: {
                  version: '0.116.0',
                  rawVersion: 'codex-cli 0.116.0',
                  supportsExec: true,
                  supportsModelFlag: true,
                  supportsConfigFlag: true,
                },
              });
              await options.trace?.onRoundFinish({
                round: 1,
                stdout: 'peer output',
                stderr: 'peer diagnostics',
                exitCode: 0,
                signal: null,
                durationMs: 12,
                command: ['codex', 'exec', 'hello'],
                model: options.model,
                modelSource: options.modelSource,
              });
              return 'I agree, this is the right approach.';
            }),
          };
          return adapter;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(output.stderr()).toContain('Round 1');
    expect(output.stderr()).toContain('codex exec');
    expect(output.stderr()).toContain('model source');
  });
});
