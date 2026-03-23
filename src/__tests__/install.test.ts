import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { installSkill } from '../install.js';

describe('installSkill', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('installs the opinionate skill to .claude/skills/opinionate/SKILL.md', async () => {
    const sandboxProject = mkdtempSync(join(tmpdir(), 'opinionate-install-'));
    tempDirs.push(sandboxProject);

    await installSkill(sandboxProject);

    const installed = readFileSync(
      join(sandboxProject, '.claude', 'skills', 'opinionate', 'SKILL.md'),
      'utf8',
    );

    expect(installed).toContain('name: opinionate');
  });

  it('is idempotent when run twice', async () => {
    const sandboxProject = mkdtempSync(join(tmpdir(), 'opinionate-install-'));
    tempDirs.push(sandboxProject);

    await installSkill(sandboxProject);
    await installSkill(sandboxProject);

    expect(
      readFileSync(join(sandboxProject, '.claude', 'skills', 'opinionate', 'SKILL.md'), 'utf8'),
    ).toContain('name: opinionate');
  });
});
