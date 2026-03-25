import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { ReasoningEffort } from '../core/runtime-config.js';

export interface UserConfig {
  version: 1;
  reasoningEffort?: ReasoningEffort;
}

const DEFAULT_CONFIG: UserConfig = { version: 1 };

export function getUserConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, 'opinionate');
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return join(home, '.config', 'opinionate');
}

export function getUserConfigPath(): string {
  return join(getUserConfigDir(), 'config.json');
}

export function loadUserConfig(): UserConfig {
  try {
    const raw = readFileSync(getUserConfigPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.version === 1) {
      return parsed as UserConfig;
    }
    return { ...DEFAULT_CONFIG };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveUserConfig(config: UserConfig): void {
  const configPath = getUserConfigPath();
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // Atomic write: write to temp file, then rename
  const tmpFile = join(dir, `.config-${randomBytes(4).toString('hex')}.tmp`);
  writeFileSync(tmpFile, JSON.stringify(config, null, 2) + '\n', 'utf8');
  renameSync(tmpFile, configPath);
}
