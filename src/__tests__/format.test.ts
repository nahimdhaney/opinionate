import { describe, expect, it } from 'vitest';
import { checkLine, failLine, infoLine, renderBox, detectColorSupport, createColors } from '../util/format.js';

describe('format utilities', () => {
  it('renders a box with title', () => {
    const box = renderBox('opinionate — multi-agent deliberation');
    expect(box).toContain('╭');
    expect(box).toContain('opinionate');
    expect(box).toContain('╰');
  });

  it('renders a check line', () => {
    expect(checkLine('Codex CLI: v0.116.0')).toBe('  ✓ Codex CLI: v0.116.0');
  });

  it('renders a fail line with remedy', () => {
    const line = failLine('Codex auth: not authenticated', 'Run `codex login`');
    expect(line).toContain('✗');
    expect(line).toContain('→ Run `codex login`');
  });

  it('renders an info line', () => {
    expect(infoLine('Model: Codex default')).toBe('  ○ Model: Codex default');
  });

  it('disables color when NO_COLOR is set', () => {
    const prev = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    try {
      const support = detectColorSupport();
      expect(support.enabled).toBe(false);
      const c = createColors(support);
      expect(c.green('ok')).toBe('ok');
    } finally {
      if (prev === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = prev;
    }
  });

  it('enables color when FORCE_COLOR is set', () => {
    const prevNo = process.env.NO_COLOR;
    const prevForce = process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = '1';
    try {
      const support = detectColorSupport();
      expect(support.enabled).toBe(true);
      const c = createColors(support);
      expect(c.green('ok')).toContain('\x1b[32m');
    } finally {
      if (prevNo === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = prevNo;
      if (prevForce === undefined) delete process.env.FORCE_COLOR;
      else process.env.FORCE_COLOR = prevForce;
    }
  });
});
