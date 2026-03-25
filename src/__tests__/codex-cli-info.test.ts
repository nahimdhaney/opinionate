import { describe, expect, it } from 'vitest';
import { buildCodexExecArgs, detectCodexCliInfo, probeCodexAuth } from '../util/codex-cli-info.js';

function fakeRunText(map: Record<string, string>, failures: Record<string, string> = {}) {
  return async (command: string, args: string[]): Promise<string> => {
    const key = `${command} ${args.join(' ')}`;
    if (failures[key]) {
      throw new Error(failures[key]);
    }
    if (!(key in map)) {
      throw new Error(`Unexpected command: ${key}`);
    }
    return map[key]!;
  };
}

function fakeRunCapture(
  map: Record<string, { stdout: string; stderr: string }>,
  failures: Record<string, string> = {},
) {
  return async (command: string, args: string[]) => {
    const key = `${command} ${args.join(' ')}`;
    if (failures[key]) {
      throw new Error(failures[key]);
    }
    if (!(key in map)) {
      throw new Error(`Unexpected command: ${key}`);
    }
    return map[key]!;
  };
}

describe('detectCodexCliInfo', () => {
  it('detects exec support from codex help output', async () => {
    const info = await detectCodexCliInfo({
      codexBin: 'codex',
      runText: fakeRunText({
        'codex --version': 'codex-cli 0.116.0',
        'codex exec --help': 'Usage: codex exec [OPTIONS] [PROMPT] [COMMAND]\n  -m, --model <MODEL>',
      }),
    });

    expect(info.version).toBe('0.116.0');
    expect(info.supportsExec).toBe(true);
    expect(info.supportsModelFlag).toBe(true);
  });

  it('marks model flag availability separately from exec support', async () => {
    const info = await detectCodexCliInfo({
      codexBin: 'codex',
      runText: fakeRunText({
        'codex --version': 'codex-cli 0.71.0',
        'codex exec --help': 'Usage: codex exec [OPTIONS] [PROMPT] [COMMAND]\n  -c, --config <key=value>',
      }),
    });

    expect(info.supportsExec).toBe(true);
    expect(info.supportsModelFlag).toBe(false);
    expect(info.supportsConfigFlag).toBe(true);
  });
});

describe('probeCodexAuth', () => {
  it('adds reasoning effort overrides to exec args when requested', () => {
    expect(
      buildCodexExecArgs(
        'hello',
        {
          supportsExec: true,
          supportsModelFlag: true,
          supportsConfigFlag: true,
        },
        'gpt-5.4',
        'medium',
      ),
    ).toEqual(['exec', '-m', 'gpt-5.4', '-c', 'model_reasoning_effort="medium"', 'hello']);
  });

  it('reports login-required errors as not authenticated', async () => {
    const auth = await probeCodexAuth({
      codexBin: 'codex',
      cwd: '/tmp/project',
      codexInfo: {
        version: '0.116.0',
        rawVersion: 'codex-cli 0.116.0',
        supportsExec: true,
        supportsModelFlag: true,
        supportsConfigFlag: true,
      },
      runText: fakeRunText({}, {
        'codex exec Return the word ok and nothing else.': 'Please run codex login to authenticate.',
      }),
    });

    expect(auth.ok).toBe(false);
    expect(auth.reason).toBe('not_authenticated');
  });

  it('reports model access failures separately', async () => {
    const auth = await probeCodexAuth({
      codexBin: 'codex',
      cwd: '/tmp/project',
      model: 'o4-mini',
      codexInfo: {
        version: '0.71.0',
        rawVersion: 'codex-cli 0.71.0',
        supportsExec: true,
        supportsModelFlag: false,
        supportsConfigFlag: true,
      },
      runText: fakeRunText({}, {
        'codex exec -c model="o4-mini" Return the word ok and nothing else.':
          'The requested model is not supported with your account.',
      }),
    });

    expect(auth.ok).toBe(false);
    expect(auth.reason).toBe('model_unavailable');
  });

  it('captures stderr diagnostics from successful auth probes', async () => {
    const auth = await probeCodexAuth({
      codexBin: 'codex',
      cwd: '/tmp/project',
      codexInfo: {
        version: '0.116.0',
        rawVersion: 'codex-cli 0.116.0',
        supportsExec: true,
        supportsModelFlag: true,
        supportsConfigFlag: true,
      },
      runCapture: fakeRunCapture({
        'codex exec Return the word ok and nothing else.': {
          stdout: 'ok',
          stderr: 'mcp: lifi failed: MCP startup failed',
        },
      }),
    });

    expect(auth.ok).toBe(true);
    expect(auth.stderr).toContain('lifi failed');
  });

  it('reports slow startup timeouts separately from auth failures', async () => {
    const auth = await probeCodexAuth({
      codexBin: 'codex',
      cwd: '/tmp/project',
      codexInfo: {
        version: '0.116.0',
        rawVersion: 'codex-cli 0.116.0',
        supportsExec: true,
        supportsModelFlag: true,
        supportsConfigFlag: true,
      },
      runText: fakeRunText({}, {
        'codex exec Return the word ok and nothing else.':
          'Command failed: process timed out after 10000ms while waiting for MCP startup.',
      }),
    });

    expect(auth.ok).toBe(false);
    expect(auth.reason).toBe('timed_out');
    expect(auth.detail).toContain('timed out');
  });
});
