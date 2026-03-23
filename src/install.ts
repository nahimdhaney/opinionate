import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getClaudeProjectSkillDir, getClaudeProjectSkillFile, getPackagedSkillSourceFile } from './util/claude-skill-paths.js';

export const SKILL_VERSION_PREFIX = '<!-- opinionate-skill-version:';

export interface InstallSkillResult {
  ok: boolean;
  skillFile: string;
  error?: string;
}

export interface InstallSkillOptions {
  sourceSkillFile?: string;
  copyFileSyncFn?: typeof copyFileSync;
  mkdirSyncFn?: typeof mkdirSync;
  existsSyncFn?: typeof existsSync;
  readFileSyncFn?: typeof readFileSync;
  writeFileSyncFn?: typeof writeFileSync;
  packageVersion?: string;
}

function getPackageVersion(): string {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    // Walk up from src/install.ts or dist/src/install.js to find package.json
    let dir = dirname(thisFile);
    for (let i = 0; i < 5; i++) {
      const pkg = resolve(dir, 'package.json');
      try {
        const json = JSON.parse(readFileSync(pkg, 'utf8'));
        if (json.name === 'opinionate' && json.version) return json.version;
      } catch { /* continue */ }
      dir = dirname(dir);
    }
  } catch { /* ignore */ }
  return '0.0.0';
}

export function parseSkillVersion(content: string): string | null {
  const match = content.match(/<!-- opinionate-skill-version: (.+?) -->/);
  return match?.[1] ?? null;
}

export async function installSkill(
  targetDir?: string,
  options: InstallSkillOptions = {},
): Promise<InstallSkillResult> {
  const cwd = targetDir ?? process.cwd();
  const skillDir = getClaudeProjectSkillDir(cwd);
  const makeDir = options.mkdirSyncFn ?? mkdirSync;
  const fileExists = options.existsSyncFn ?? existsSync;
  const readFile = options.readFileSyncFn ?? readFileSync;
  const writeFile = options.writeFileSyncFn ?? writeFileSync;

  if (!fileExists(skillDir)) {
    makeDir(skillDir, { recursive: true });
  }

  const sourceSkill = options.sourceSkillFile ?? getPackagedSkillSourceFile(import.meta.url);
  const destSkill = getClaudeProjectSkillFile(cwd);

  if (!fileExists(sourceSkill)) {
    return {
      ok: false,
      skillFile: destSkill,
      error: `Could not find skill.md at ${sourceSkill}. Is the package installed correctly?`,
    };
  }

  const version = options.packageVersion ?? getPackageVersion();
  const sourceContent = readFile(sourceSkill, 'utf8') as string;
  const versionMarker = `<!-- opinionate-skill-version: ${version} -->\n`;
  // Strip any existing version marker before prepending the new one
  const cleanContent = sourceContent.replace(/<!-- opinionate-skill-version: .+? -->\n?/, '');
  writeFile(destSkill, versionMarker + cleanContent, 'utf8');

  return {
    ok: true,
    skillFile: destSkill,
  };
}

async function main(): Promise<void> {
  const result = await installSkill(process.argv[2] ? resolve(process.argv[2]) : undefined);
  if (!result.ok) {
    throw new Error(result.error);
  }

  process.stderr.write(`Installed opinionate skill to ${result.skillFile}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
