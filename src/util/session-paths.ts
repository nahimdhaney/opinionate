import { join } from 'node:path';

export function getOpinionateDir(cwd: string): string {
  return join(cwd, '.opinionate');
}

export function getSessionsDir(cwd: string): string {
  return join(getOpinionateDir(cwd), 'sessions');
}

export function getSessionDir(cwd: string, sessionId: string): string {
  return join(getSessionsDir(cwd), sessionId);
}

export function getSessionFile(cwd: string, sessionId: string): string {
  return join(getSessionDir(cwd, sessionId), 'session.json');
}

export function getSessionSnapshotsDir(cwd: string, sessionId: string): string {
  return join(getSessionDir(cwd, sessionId), 'snapshots');
}
