import { execFile } from 'node:child_process';

type ExecFileLike = typeof execFile;

export function which(command: string, execFileFn: ExecFileLike = execFile): Promise<string | null> {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    execFileFn(cmd, [command], (error, stdout) => {
      if (error) {
        resolve(null);
      } else {
        resolve(stdout.trim() || null);
      }
    });
  });
}
