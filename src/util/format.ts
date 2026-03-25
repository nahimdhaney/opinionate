function repeat(char: string, length: number): string {
  return char.repeat(Math.max(0, length));
}

// ---------------------------------------------------------------------------
// Color support
// ---------------------------------------------------------------------------

export interface ColorSupport {
  enabled: boolean;
}

export function detectColorSupport(stream?: { isTTY?: boolean }): ColorSupport {
  if (process.env.NO_COLOR !== undefined) return { enabled: false };
  if (process.env.FORCE_COLOR !== undefined) return { enabled: true };
  return { enabled: !!(stream ?? process.stderr).isTTY };
}

export type ColorFn = (text: string) => string;

export interface Colors {
  bold: ColorFn;
  dim: ColorFn;
  red: ColorFn;
  green: ColorFn;
  yellow: ColorFn;
  cyan: ColorFn;
  white: ColorFn;
}

export function createColors(support: ColorSupport): Colors {
  const wrap = (code: string, reset: string): ColorFn =>
    support.enabled
      ? (text: string) => `\x1b[${code}m${text}\x1b[${reset}m`
      : (text: string) => text;

  return {
    bold: wrap('1', '22'),
    dim: wrap('2', '22'),
    red: wrap('31', '39'),
    green: wrap('32', '39'),
    yellow: wrap('33', '39'),
    cyan: wrap('36', '39'),
    white: wrap('37', '39'),
  };
}

export function renderBox(title: string): string {
  const content = `  ${title}  `;
  const border = repeat('─', content.length);
  return `╭${border}╮\n│${content}│\n╰${border}╯`;
}

export function renderColorHeader(name: string, version: string, colors: Colors): string {
  return `  ${colors.bold(colors.cyan(name))}  ${colors.dim(`v${version}`)}`;
}

export function checkLine(text: string): string {
  return `  ✓ ${text}`;
}

export function failLine(text: string, remedy?: string): string {
  if (!remedy) {
    return `  ✗ ${text}`;
  }

  return `  ✗ ${text}\n    → ${remedy}`;
}

export function infoLine(text: string): string {
  return `  ○ ${text}`;
}

export function sectionHeader(text: string): string {
  return `${text}\n`;
}
