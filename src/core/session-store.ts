import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type { DeliberationMode, DeliberationSessionMemory } from './types.js';
import { getSessionDir, getSessionFile, getSessionsDir } from '../util/session-paths.js';

export interface SessionRun {
  id: string;
  startedAt: number;
  completedAt?: number;
  mode: DeliberationMode;
  task: string;
  rounds: number;
  agreed: boolean;
  partialRounds?: number[];
  summary: string;
}

export interface AppendSessionRunOptions {
  status?: DeliberationSession['status'];
  now?: number;
}

export interface SessionTrackedFile {
  path: string;
  sha256: string;
  sizeBytes: number;
  lastIncludedAt: number;
  snapshotFile?: string;
}

export interface DeliberationSession {
  version: 1;
  id: string;
  cwd: string;
  mode: DeliberationMode;
  task: string;
  status: 'active' | 'completed' | 'abandoned';
  createdAt: number;
  lastAccessedAt: number;
  updatedAt: number;
  memory: DeliberationSessionMemory;
  files: SessionTrackedFile[];
  runs: SessionRun[];
}

export interface CreateSessionInput {
  cwd: string;
  mode: DeliberationMode;
  task: string;
  id?: string;
  now?: number;
}

export interface PruneExpiredSessionsOptions {
  now?: number;
  ttlMs?: number;
}

const EMPTY_MEMORY: DeliberationSessionMemory = {
  summary: '',
  acceptedDecisions: [],
  rejectedIdeas: [],
  openQuestions: [],
  source: 'heuristic',
};

function formatDatePart(date: Date): string {
  return [
    date.getUTCFullYear().toString().padStart(4, '0'),
    (date.getUTCMonth() + 1).toString().padStart(2, '0'),
    date.getUTCDate().toString().padStart(2, '0'),
  ].join('');
}

function formatTimePart(date: Date): string {
  return [
    date.getUTCHours().toString().padStart(2, '0'),
    date.getUTCMinutes().toString().padStart(2, '0'),
    date.getUTCSeconds().toString().padStart(2, '0'),
  ].join('');
}

function randomSuffix(randomBytesFactory: (size: number) => Buffer = randomBytes): string {
  return Array.from(randomBytesFactory(6))
    .map((value) => (value % 36).toString(36))
    .join('')
    .slice(0, 6);
}

export function generateSessionId(
  date: Date = new Date(),
  randomFn?: () => number,
): string {
  const suffix = randomFn
    ? Array.from({ length: 6 }, () => Math.floor(randomFn() * 36).toString(36)).join('')
    : randomSuffix();
  return `${formatDatePart(date)}-${formatTimePart(date)}-${suffix}`;
}

async function ensureSessionDir(cwd: string, sessionId: string): Promise<void> {
  await mkdir(getSessionDir(cwd, sessionId), { recursive: true });
}

export async function saveSession(cwd: string, session: DeliberationSession): Promise<void> {
  await ensureSessionDir(cwd, session.id);
  await writeFile(getSessionFile(cwd, session.id), JSON.stringify(session, null, 2) + '\n', 'utf8');
}

export async function createSession(input: CreateSessionInput): Promise<DeliberationSession> {
  const now = input.now ?? Date.now();
  const id = input.id ?? generateSessionId();
  const session: DeliberationSession = {
    version: 1,
    id,
    cwd: input.cwd,
    mode: input.mode,
    task: input.task,
    status: 'active',
    createdAt: now,
    lastAccessedAt: now,
    updatedAt: now,
    memory: { ...EMPTY_MEMORY },
    files: [],
    runs: [],
  };
  await saveSession(input.cwd, session);
  return session;
}

export async function loadSession(cwd: string, sessionId: string): Promise<DeliberationSession> {
  let raw: string;
  try {
    raw = await readFile(getSessionFile(cwd, sessionId), 'utf8');
  } catch {
    throw new Error(`Session "${sessionId}" not found.`);
  }
  try {
    return JSON.parse(raw) as DeliberationSession;
  } catch {
    throw new Error(`Session "${sessionId}" exists but contains invalid JSON. Delete .opinionate/sessions/${sessionId}/ and retry.`);
  }
}

export async function updateSessionMemory(
  cwd: string,
  sessionId: string,
  memory: DeliberationSessionMemory,
): Promise<DeliberationSession> {
  const session = await loadSession(cwd, sessionId);
  const now = Date.now();
  session.memory = memory;
  session.updatedAt = now;
  session.lastAccessedAt = now;
  await saveSession(cwd, session);
  return session;
}

export async function updateSessionFiles(
  cwd: string,
  sessionId: string,
  files: SessionTrackedFile[],
): Promise<DeliberationSession> {
  const session = await loadSession(cwd, sessionId);
  const now = Date.now();
  session.files = files;
  session.updatedAt = now;
  session.lastAccessedAt = now;
  await saveSession(cwd, session);
  return session;
}

export async function appendSessionRun(
  cwd: string,
  sessionId: string,
  run: SessionRun,
  options: AppendSessionRunOptions = {},
): Promise<DeliberationSession> {
  const session = await loadSession(cwd, sessionId);
  const now = options.now ?? Date.now();
  session.runs.push(run);
  session.updatedAt = now;
  session.lastAccessedAt = now;
  session.status = options.status ?? 'active';
  await saveSession(cwd, session);
  return session;
}

export async function pruneExpiredSessions(
  cwd: string,
  options: PruneExpiredSessionsOptions = {},
): Promise<number> {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? 30 * 24 * 60 * 60 * 1000;
  const sessionsDir = getSessionsDir(cwd);
  await mkdir(sessionsDir, { recursive: true });

  let pruned = 0;
  const entries = await readdir(sessionsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    try {
      const session = await loadSession(cwd, entry.name);
      const expired = session.updatedAt <= now - ttlMs;
      const pruneable = session.status === 'completed' || session.status === 'abandoned';
      if (expired && pruneable) {
        await rm(getSessionDir(cwd, entry.name), { recursive: true, force: true });
        pruned++;
      }
    } catch {
      continue;
    }
  }

  return pruned;
}
