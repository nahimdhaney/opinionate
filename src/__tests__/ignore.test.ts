import { describe, it, expect } from 'vitest';
import { IgnoreMatcher } from '../util/ignore.js';

describe('IgnoreMatcher', () => {
  it('matches exact filenames', () => {
    const matcher = new IgnoreMatcher(['.env']);
    expect(matcher.isIgnored('.env')).toBe(true);
    expect(matcher.isIgnored('src/.env')).toBe(true);
    expect(matcher.isIgnored('.envrc')).toBe(false);
  });

  it('matches wildcard patterns', () => {
    const matcher = new IgnoreMatcher(['*.pem', '*.key']);
    expect(matcher.isIgnored('server.pem')).toBe(true);
    expect(matcher.isIgnored('certs/server.key')).toBe(true);
    expect(matcher.isIgnored('readme.md')).toBe(false);
  });

  it('matches .env.* patterns', () => {
    const matcher = new IgnoreMatcher(['.env.*']);
    expect(matcher.isIgnored('.env.local')).toBe(true);
    expect(matcher.isIgnored('.env.production')).toBe(true);
    expect(matcher.isIgnored('config/.env.staging')).toBe(true);
    expect(matcher.isIgnored('.env')).toBe(false);
  });

  it('matches substring patterns like *credential*', () => {
    const matcher = new IgnoreMatcher(['*credential*']);
    expect(matcher.isIgnored('credentials.json')).toBe(true);
    expect(matcher.isIgnored('config/db-credentials.yaml')).toBe(true);
    expect(matcher.isIgnored('readme.md')).toBe(false);
  });

  it('supports directory rules with trailing slash', () => {
    const matcher = new IgnoreMatcher(['node_modules/', 'dist/']);
    expect(matcher.isIgnored('node_modules/package/index.js')).toBe(true);
    expect(matcher.isIgnored('dist/bundle.js')).toBe(true);
    expect(matcher.isIgnored('src/dist-helper.ts')).toBe(false);
  });

  it('supports negation', () => {
    const matcher = new IgnoreMatcher(['*.key', '!public.key']);
    expect(matcher.isIgnored('private.key')).toBe(true);
    expect(matcher.isIgnored('public.key')).toBe(false);
  });

  it('ignores comments and blank lines', () => {
    const matcher = new IgnoreMatcher([
      '# This is a comment',
      '',
      '  ',
      '.env',
    ]);
    expect(matcher.isIgnored('.env')).toBe(true);
  });

  it('supports anchored patterns with /', () => {
    const matcher = new IgnoreMatcher(['config/secrets.yaml']);
    expect(matcher.isIgnored('config/secrets.yaml')).toBe(true);
    expect(matcher.isIgnored('other/config/secrets.yaml')).toBe(false);
  });

  it('supports ** globstar', () => {
    const matcher = new IgnoreMatcher(['**/secrets/**']);
    expect(matcher.isIgnored('foo/secrets/bar.txt')).toBe(true);
    expect(matcher.isIgnored('secrets/keys.txt')).toBe(true);
  });
});
