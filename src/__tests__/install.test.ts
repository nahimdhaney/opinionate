import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { installSkill, parseSkillVersion } from '../install.js';

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

    const result = await installSkill(sandboxProject);

    const installed = readFileSync(
      join(sandboxProject, '.claude', 'skills', 'opinionate', 'SKILL.md'),
      'utf8',
    );

    expect(result.ok).toBe(true);
    expect(result.skillFile).toContain('.claude/skills/opinionate/SKILL.md');
    expect(installed).toContain('name: opinionate');
  });

  it('is idempotent when run twice', async () => {
    const sandboxProject = mkdtempSync(join(tmpdir(), 'opinionate-install-'));
    tempDirs.push(sandboxProject);

    await installSkill(sandboxProject);
    const result = await installSkill(sandboxProject);

    expect(result.ok).toBe(true);
    expect(
      readFileSync(join(sandboxProject, '.claude', 'skills', 'opinionate', 'SKILL.md'), 'utf8'),
    ).toContain('name: opinionate');
  });

  it('embeds a version marker in the installed skill', async () => {
    const sandboxProject = mkdtempSync(join(tmpdir(), 'opinionate-install-'));
    tempDirs.push(sandboxProject);

    await installSkill(sandboxProject, { packageVersion: '0.1.0' });
    const installed = readFileSync(
      join(sandboxProject, '.claude', 'skills', 'opinionate', 'SKILL.md'),
      'utf8',
    );

    expect(installed).toContain('<!-- opinionate-skill-version: 0.1.0 -->');
    expect(parseSkillVersion(installed)).toBe('0.1.0');
  });

  it('returns a structured failure when the source skill is missing', async () => {
    const sandboxProject = mkdtempSync(join(tmpdir(), 'opinionate-install-'));
    tempDirs.push(sandboxProject);

    const result = await installSkill(sandboxProject, {
      sourceSkillFile: join(sandboxProject, 'missing-skill.md'),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Could not find skill.md');
  });
});
