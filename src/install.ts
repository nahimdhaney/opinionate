import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getClaudeProjectSkillDir, getClaudeProjectSkillFile, getPackagedSkillSourceFile } from './util/claude-skill-paths.js';

export async function installSkill(targetDir?: string): Promise<void> {
  const cwd = targetDir ?? process.cwd();
  const skillDir = getClaudeProjectSkillDir(cwd);

  if (!existsSync(skillDir)) {
    mkdirSync(skillDir, { recursive: true });
  }

  const sourceSkill = getPackagedSkillSourceFile(import.meta.url);
  const destSkill = getClaudeProjectSkillFile(cwd);

  if (!existsSync(sourceSkill)) {
    throw new Error(`Could not find skill.md at ${sourceSkill}. Is the package installed correctly?`);
  }

  copyFileSync(sourceSkill, destSkill);

  const log = (msg: string) => process.stderr.write(`${msg}\n`);
  log(`Installed opinionate skill to ${destSkill}`);
  log('');
  log('Start a new Claude Code session in this project to use it.');
  log('Claude will auto-trigger it for complex decisions, or you can invoke it with /opinionate.');
  log('If it does not appear, run `opinionate doctor` from the project root.');
}

async function main(): Promise<void> {
  await installSkill(process.argv[2] ? resolve(process.argv[2]) : undefined);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
