export const EXPECTED_INSTALL_SKILL_SCRIPT = 'node dist/src/cli.js install';

export const REQUIRED_PACKAGE_ARTIFACT_ENTRIES = [
  'dist/src/cli.js',
  'dist/src/install.js',
  'skill/opinionate/skill.md',
];

export function validateInstallSkillScript(packageJson) {
  const script = packageJson?.scripts?.['install-skill'];
  const errors = [];

  if (script !== EXPECTED_INSTALL_SKILL_SCRIPT) {
    errors.push(`scripts.install-skill must equal "${EXPECTED_INSTALL_SKILL_SCRIPT}"`);
  }

  if (typeof script === 'string' && script.includes('dist/skill/')) {
    errors.push('scripts.install-skill must not reference "dist/skill/"');
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function parseNpmPackFilename(output) {
  const parsed = JSON.parse(output);
  const filename = Array.isArray(parsed) ? parsed[0]?.filename : parsed?.filename;

  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error('npm pack --json output did not include a filename');
  }

  return filename;
}

export function findMissingPackageArtifactEntries(entries) {
  const normalized = new Set(entries.map((entry) => entry.replace(/^package\//, '')));
  return REQUIRED_PACKAGE_ARTIFACT_ENTRIES.filter((entry) => !normalized.has(entry));
}
