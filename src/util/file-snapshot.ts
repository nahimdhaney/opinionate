import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import type { FileDelta } from '../core/types.js';

export interface CaptureFileSnapshotInput {
  path: string;
  content: string;
}

export interface CapturedFileSnapshot {
  sha256: string;
  sizeBytes: number;
  snapshotFile: string;
}

export interface BuildFileDeltaInput {
  path: string;
  previousContent: string;
  currentContent: string;
  maxBytes?: number;
}

export function hashFileContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function captureFileSnapshot(
  snapshotsDir: string,
  input: CaptureFileSnapshotInput,
): Promise<CapturedFileSnapshot> {
  await mkdir(snapshotsDir, { recursive: true });
  const sha256 = hashFileContent(input.content);
  const snapshotFile = `${sha256}.txt`;
  const snapshotPath = `${snapshotsDir}/${snapshotFile}`;

  if (!existsSync(snapshotPath)) {
    await writeFile(snapshotPath, input.content, 'utf8');
  }

  return {
    sha256,
    sizeBytes: Buffer.byteLength(input.content, 'utf8'),
    snapshotFile,
  };
}

function splitLines(content: string): string[] {
  return content.split(/\r?\n/);
}

export function buildFileDelta(input: BuildFileDeltaInput): FileDelta | null {
  if (input.previousContent === input.currentContent) {
    return null;
  }

  const previousLines = splitLines(input.previousContent);
  const currentLines = splitLines(input.currentContent);

  let prefix = 0;
  while (
    prefix < previousLines.length &&
    prefix < currentLines.length &&
    previousLines[prefix] === currentLines[prefix]
  ) {
    prefix++;
  }

  let previousSuffix = previousLines.length - 1;
  let currentSuffix = currentLines.length - 1;
  while (
    previousSuffix >= prefix &&
    currentSuffix >= prefix &&
    previousLines[previousSuffix] === currentLines[currentSuffix]
  ) {
    previousSuffix--;
    currentSuffix--;
  }

  const removed = previousLines.slice(prefix, previousSuffix + 1);
  const added = currentLines.slice(prefix, currentSuffix + 1);
  const changedLineCount = removed.length + added.length;
  const summary = `${changedLineCount} line${changedLineCount === 1 ? '' : 's'} changed`;
  const diffLines = [
    `@@ -${prefix + 1},${Math.max(removed.length, 1)} +${prefix + 1},${Math.max(added.length, 1)} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ];
  const diff = diffLines.join('\n');

  if (Buffer.byteLength(diff, 'utf8') > (input.maxBytes ?? 8 * 1024)) {
    return {
      path: input.path,
      status: 'changed',
      summary: 'file changed (delta too large; read from disk)',
      changedLineCount,
    };
  }

  return {
    path: input.path,
    status: 'changed',
    summary,
    diff,
    changedLineCount,
  };
}
