import { which } from './which.js';

export type InstallMode = 'global' | 'npx' | 'project-local';

export interface LauncherInfo {
  mode: InstallMode;
  argv: string[];
  updateCommand: string;
}

export async function detectLauncher(): Promise<LauncherInfo> {
  // Check npm_execpath for npx detection
  const execPath = process.env.npm_execpath ?? '';
  if (execPath.includes('npx') || process.env.npm_command === 'exec') {
    return {
      mode: 'npx',
      argv: ['npx', 'opinionate@latest'],
      updateCommand: 'npx opinionate@latest install',
    };
  }

  // Check if opinionate is globally available
  const globalBin = await which('opinionate');
  if (globalBin) {
    return {
      mode: 'global',
      argv: ['opinionate'],
      updateCommand: 'npm install -g opinionate@latest && opinionate install',
    };
  }

  // Fallback: project-local
  return {
    mode: 'project-local',
    argv: ['npx', 'opinionate'],
    updateCommand: 'npm update opinionate && npx opinionate install',
  };
}

export function buildLauncherFromMode(mode: InstallMode): LauncherInfo {
  switch (mode) {
    case 'global':
      return {
        mode: 'global',
        argv: ['opinionate'],
        updateCommand: 'npm install -g opinionate@latest && opinionate install',
      };
    case 'npx':
      return {
        mode: 'npx',
        argv: ['npx', 'opinionate@latest'],
        updateCommand: 'npx opinionate@latest install',
      };
    case 'project-local':
      return {
        mode: 'project-local',
        argv: ['npx', 'opinionate'],
        updateCommand: 'npm update opinionate && npx opinionate install',
      };
  }
}

export function formatRunExample(launcher: LauncherInfo): string {
  return `${launcher.argv.join(' ')} run --mode plan --task "hello world" --verbose`;
}

export function formatUpdateCommand(launcher: LauncherInfo): string {
  return launcher.updateCommand;
}
