import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_PACKAGE_ARTIFACT_ENTRIES,
  findMissingPackageArtifactEntries,
  parseNpmPackFilename,
  validateInstallSkillScript,
} from './package-artifact-check-lib.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = resolve(rootDir, 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const scriptCheck = validateInstallSkillScript(packageJson);

if (!scriptCheck.ok) {
  for (const error of scriptCheck.errors) {
    process.stderr.write(`Package script error: ${error}\n`);
  }
  process.exit(1);
}

if (!existsSync(resolve(rootDir, 'dist', 'src', 'cli.js'))) {
  process.stderr.write('Build artifact missing: dist/src/cli.js. Run `pnpm build` first.\n');
  process.exit(1);
}

let tarballPath;

try {
  const packOutput = execFileSync('npm', ['pack', '--json'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  tarballPath = resolve(rootDir, parseNpmPackFilename(packOutput));
  const tarEntries = execFileSync('tar', ['-tzf', tarballPath], {
    cwd: rootDir,
    encoding: 'utf8',
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const missing = findMissingPackageArtifactEntries(tarEntries);
  if (missing.length > 0) {
    process.stderr.write(
      `Packed artifact is missing required entries: ${missing.join(', ')}\nExpected entries: ${REQUIRED_PACKAGE_ARTIFACT_ENTRIES.join(', ')}\n`,
    );
    process.exit(1);
  }

  process.stdout.write('Package artifact verification passed.\n');
} finally {
  if (tarballPath) {
    rmSync(tarballPath, { force: true });
  }
}
