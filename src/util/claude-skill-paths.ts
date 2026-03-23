import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function getClaudeProjectSkillDir(cwd: string): string {
  return join(cwd, '.claude', 'skills', 'opinionate');
}

export function getClaudeProjectSkillFile(cwd: string): string {
  return join(getClaudeProjectSkillDir(cwd), 'SKILL.md');
}

export function getPackagedSkillSourceFile(moduleUrl: string): string {
  const moduleDir = dirname(fileURLToPath(moduleUrl));
  const candidates = [
    resolve(moduleDir, '..'),
    resolve(moduleDir, '..', '..'),
  ].map((root) => join(root, 'skill', 'opinionate', 'skill.md'));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[candidates.length - 1]!;
}
