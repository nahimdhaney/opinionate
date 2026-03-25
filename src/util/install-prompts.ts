import * as clack from '@clack/prompts';
import type { ReasoningEffort } from '../core/runtime-config.js';
import type { InstallMode } from './launcher.js';

export interface SetupResult {
  installMode: InstallMode;
  reasoningEffort: ReasoningEffort;
  shouldSave: boolean;
  cancelled: boolean;
}

interface ReasoningPreset {
  value: ReasoningEffort;
  label: string;
  hint: string;
}

const REASONING_PRESETS: ReasoningPreset[] = [
  { value: 'low', label: 'Low', hint: 'Fastest responses, minimal reasoning' },
  { value: 'medium', label: 'Medium', hint: 'Good balance of quality and speed — recommended' },
  { value: 'high', label: 'High', hint: 'Careful analysis, slower responses' },
  { value: 'xhigh', label: 'Extra High', hint: 'Deepest reasoning — may timeout on large contexts' },
];

export async function runInteractiveSetup(options: {
  currentCodexEffort?: string;
}): Promise<SetupResult> {
  const installMode = await clack.select({
    message: 'How are you running opinionate?',
    options: [
      { value: 'global' as InstallMode, label: 'Global install', hint: 'npm install -g opinionate' },
      { value: 'npx' as InstallMode, label: 'npx / zero-install', hint: 'npx opinionate@latest' },
      { value: 'project-local' as InstallMode, label: 'Project dependency', hint: 'npm install -D opinionate' },
    ],
  });

  if (clack.isCancel(installMode)) {
    return { installMode: 'global', reasoningEffort: 'medium', shouldSave: false, cancelled: true };
  }

  if (options.currentCodexEffort?.toLowerCase() === 'xhigh') {
    clack.note(
      'Your Codex config uses xhigh reasoning, which often causes timeouts.\nWe recommend "Recommended" (medium) for interactive use.',
      'Reasoning Effort',
    );
  }

  const reasoningEffort = await clack.select({
    message: 'Select reasoning effort for Codex peer:',
    options: REASONING_PRESETS.map((p) => ({
      value: p.value,
      label: p.label,
      hint: p.hint,
    })),
    initialValue: 'medium' as ReasoningEffort,
  });

  if (clack.isCancel(reasoningEffort)) {
    return { installMode: installMode as InstallMode, reasoningEffort: 'medium', shouldSave: false, cancelled: true };
  }

  const shouldSave = await clack.confirm({
    message: 'Save this as your default reasoning effort?',
    initialValue: true,
  });

  if (clack.isCancel(shouldSave)) {
    return { installMode: installMode as InstallMode, reasoningEffort: reasoningEffort as ReasoningEffort, shouldSave: false, cancelled: true };
  }

  return {
    installMode: installMode as InstallMode,
    reasoningEffort: reasoningEffort as ReasoningEffort,
    shouldSave: shouldSave as boolean,
    cancelled: false,
  };
}
