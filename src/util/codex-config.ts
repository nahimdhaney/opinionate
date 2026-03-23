import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CodexConfigSnapshot {
  path: string;
  model?: string;
  reasoningEffort?: string;
}

export interface ReadCodexConfigInput {
  homeDir?: string;
  fileExists?: (path: string) => boolean;
  readFile?: (path: string) => string;
}

function parseTomlString(source: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*"([^"\\n]+)"\\s*$`, 'm'));
  return match?.[1];
}

export function readCodexConfig(input: ReadCodexConfigInput = {}): CodexConfigSnapshot | undefined {
  const homeDir = input.homeDir ?? homedir();
  const configPath = join(homeDir, '.codex', 'config.toml');
  const fileExists = input.fileExists ?? existsSync;
  const readFile = input.readFile ?? ((path: string) => readFileSync(path, 'utf8'));

  if (!fileExists(configPath)) {
    return undefined;
  }

  try {
    const source = readFile(configPath);
    return {
      path: configPath,
      model: parseTomlString(source, 'model'),
      reasoningEffort: parseTomlString(source, 'model_reasoning_effort'),
    };
  } catch {
    return {
      path: configPath,
    };
  }
}
