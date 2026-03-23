import { readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Gitignore-compatible pattern matcher.
 * Supports: wildcards (*), directory-only rules (trailing /), negation (!),
 * double-star (**), and comment lines (#).
 */
export class IgnoreMatcher {
  private rules: Array<{ pattern: RegExp; negated: boolean }> = [];

  constructor(patterns: string[]) {
    for (const raw of patterns) {
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const negated = trimmed.startsWith('!');
      const clean = negated ? trimmed.slice(1) : trimmed;
      const regex = this.patternToRegex(clean);

      this.rules.push({ pattern: regex, negated });
    }
  }

  isIgnored(filePath: string): boolean {
    // Normalize to forward slashes
    const normalized = filePath.split(sep).join('/');

    let ignored = false;
    for (const rule of this.rules) {
      if (rule.pattern.test(normalized)) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  }

  private patternToRegex(pattern: string): RegExp {
    let p = pattern;

    // Trailing slash means directory-only — for our purposes (we only check files)
    // we treat it as a prefix match
    const dirOnly = p.endsWith('/');
    if (dirOnly) {
      p = p.slice(0, -1);
    }

    // If pattern contains a slash (not trailing) AND is not just globstars,
    // it's anchored to the root
    const strippedOfGlobstar = p.replace(/\*\*/g, '').replace(/\//g, '');
    const anchored = p.includes('/') && strippedOfGlobstar.length > 0 && !p.startsWith('**');

    // Escape regex special chars except * and ?
    let regex = p.replace(/[.+^${}()|[\]\\]/g, '\\$&');

    // Handle **/ at the start (matches any leading path including none)
    regex = regex.replace(/^\*\*\//, '<<LEADING_GLOBSTAR>>');
    // Handle /** at the end (matches any trailing path)
    regex = regex.replace(/\/\*\*$/, '<<TRAILING_GLOBSTAR>>');
    // Handle /**/ in the middle (matches zero or more directories)
    regex = regex.replace(/\/\*\*\//g, '<<MID_GLOBSTAR>>');
    // Handle remaining ** (treat as *)
    regex = regex.replace(/\*\*/g, '.*');
    // Handle * (match within a single segment)
    regex = regex.replace(/\*/g, '[^/]*');
    // Handle ?
    regex = regex.replace(/\?/g, '[^/]');
    // Restore globstars
    regex = regex.replace(/<<LEADING_GLOBSTAR>>/g, '((.+/)?)')
    regex = regex.replace(/<<TRAILING_GLOBSTAR>>/g, '(/.*)?');
    regex = regex.replace(/<<MID_GLOBSTAR>>/g, '(/(.+/)?)');

    if (dirOnly) {
      // Match the directory as a prefix
      return new RegExp(anchored ? `^${regex}(/|$)` : `(^|/)${regex}(/|$)`);
    }

    if (anchored) {
      return new RegExp(`^${regex}$`);
    }

    // Unanchored: match anywhere in the path (basename or full path)
    return new RegExp(`(^|/)${regex}$`);
  }
}

const DEFAULT_SENSITIVE_PATTERNS = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.jks',
  '*credential*',
  '*secret*',
];

/**
 * Loads and merges ignore rules from .gitignore and .opinionateignore
 * (falling back to .deliberateignore with a deprecation warning).
 * Returns an IgnoreMatcher that respects all three layers:
 * 1. Default sensitive patterns (always active)
 * 2. .gitignore rules
 * 3. .opinionateignore / .deliberateignore rules
 */
export function loadIgnoreRules(cwd: string): IgnoreMatcher {
  const allPatterns: string[] = [...DEFAULT_SENSITIVE_PATTERNS];

  // Load .gitignore
  const gitignorePath = join(cwd, '.gitignore');
  if (existsSync(gitignorePath)) {
    try {
      const content = readFileSync(gitignorePath, 'utf-8');
      allPatterns.push(...content.split('\n'));
    } catch {
      // Ignore read errors
    }
  }

  // Load .opinionateignore, falling back to .deliberateignore
  const opinionateignorePath = join(cwd, '.opinionateignore');
  const deliberateignorePath = join(cwd, '.deliberateignore');
  if (existsSync(opinionateignorePath)) {
    try {
      const content = readFileSync(opinionateignorePath, 'utf-8');
      allPatterns.push(...content.split('\n'));
    } catch {
      // Ignore read errors
    }
  } else if (existsSync(deliberateignorePath)) {
    process.stderr.write(
      '[opinionate] Warning: .deliberateignore is deprecated; rename it to .opinionateignore.\n',
    );
    try {
      const content = readFileSync(deliberateignorePath, 'utf-8');
      allPatterns.push(...content.split('\n'));
    } catch {
      // Ignore read errors
    }
  }

  return new IgnoreMatcher(allPatterns);
}

/**
 * Check if a file path should be excluded from context sent to peer adapters.
 */
export function isFileIgnored(filePath: string, cwd: string, matcher: IgnoreMatcher): boolean {
  const rel = relative(cwd, filePath) || filePath;
  return matcher.isIgnored(rel);
}
