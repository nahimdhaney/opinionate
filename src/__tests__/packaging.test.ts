import { describe, expect, it } from 'vitest';
import {
  REQUIRED_PACKAGE_ARTIFACT_ENTRIES,
  findMissingPackageArtifactEntries,
  parseNpmPackFilename,
  validateInstallSkillScript,
} from '../../scripts/package-artifact-check-lib.mjs';

describe('validateInstallSkillScript', () => {
  it('accepts the compiled cli install entrypoint', () => {
    const result = validateInstallSkillScript({
      scripts: {
        'install-skill': 'node dist/src/cli.js install',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects missing or stale install entrypoints', () => {
    const result = validateInstallSkillScript({
      scripts: {
        'install-skill': 'node dist/skill/deliberate/install.js',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'scripts.install-skill must equal "node dist/src/cli.js install"',
    );
    expect(result.errors).toContain('scripts.install-skill must not reference "dist/skill/"');
  });
});

describe('parseNpmPackFilename', () => {
  it('returns the generated tarball name from npm pack --json output', () => {
    const filename = parseNpmPackFilename(
      JSON.stringify([{ filename: 'opinionate-0.1.0.tgz', id: 'opinionate@0.1.0' }]),
    );

    expect(filename).toBe('opinionate-0.1.0.tgz');
  });

  it('throws when npm pack output has no filename', () => {
    expect(() => parseNpmPackFilename(JSON.stringify([{ id: 'opinionate@0.1.0' }]))).toThrow(
      'npm pack --json output did not include a filename',
    );
  });
});

describe('findMissingPackageArtifactEntries', () => {
  it('matches the required packed files', () => {
    const missing = findMissingPackageArtifactEntries(
      REQUIRED_PACKAGE_ARTIFACT_ENTRIES.map((entry) => `package/${entry}`),
    );

    expect(missing).toEqual([]);
  });

  it('reports missing packed files', () => {
    const missing = findMissingPackageArtifactEntries([
      'package/dist/src/cli.js',
      'package/skill/opinionate/skill.md',
    ]);

    expect(missing).toEqual(['dist/src/install.js']);
  });
});
