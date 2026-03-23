import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { buildFileDelta, captureFileSnapshot } from '../util/file-snapshot.js';

describe('file-snapshot', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deduplicates snapshot blobs by content hash', async () => {
    const snapshotsDir = mkdtempSync(join(tmpdir(), 'opinionate-snapshots-'));
    tempDirs.push(snapshotsDir);

    const first = await captureFileSnapshot(snapshotsDir, {
      path: 'docs/plan.md',
      content: '# Plan\ncontent\n',
    });
    const second = await captureFileSnapshot(snapshotsDir, {
      path: 'docs/plan-copy.md',
      content: '# Plan\ncontent\n',
    });

    expect(first.sha256).toBe(second.sha256);
    expect(first.snapshotFile).toBe(second.snapshotFile);
    expect(readFileSync(join(snapshotsDir, first.snapshotFile!), 'utf8')).toContain('# Plan');
  });

  it('renders a compact unified diff for a small text change', () => {
    const delta = buildFileDelta({
      path: 'docs/plan.md',
      previousContent: ['alpha', 'beta', 'gamma'].join('\n'),
      currentContent: ['alpha', 'beta changed', 'gamma'].join('\n'),
    });

    expect(delta?.diff).toContain('@@');
    expect(delta?.diff).toContain('-beta');
    expect(delta?.diff).toContain('+beta changed');
  });

  it('falls back to a summary marker when a delta exceeds the byte budget', () => {
    const delta = buildFileDelta({
      path: 'docs/plan.md',
      previousContent: 'a\n'.repeat(200),
      currentContent: 'b\n'.repeat(200),
      maxBytes: 128,
    });

    expect(delta?.diff).toBeUndefined();
    expect(delta?.summary).toContain('delta too large');
  });
});
