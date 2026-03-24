# Premium Terminal UX Plan

**Date:** 2026-03-24
**Status:** Draft
**Goal:** Make opinionate's terminal output feel polished and professional during install, doctor, and deliberation runs. The tool should feel like a premium CLI experience — clear visual hierarchy, colored status, progress that tells a story.

---

## Current State

### Install output
- Plain box with version, no color on the header
- Status lines are uncolored (✓/✗/○ are plain text)
- Doctor results dump as a flat list with no visual grouping
- Success block says "Next:" with plain text instructions

### Deliberation output
- Box header shows metadata but is uncolored
- Round start/complete lines use Unicode symbols but no color in non-TTY fallback is indistinguishable from color mode
- Verbose diagnostics are dim but blend with round lines
- No visual separator between rounds
- No summary of what files/context were sent
- No elapsed time shown until round completes

### Doctor output
- Same flat list as install
- No section headers between categories (codex, auth, model, skill, binary)
- Warnings blend with info lines

---

## Proposed Improvements

### 1. Colored status lines everywhere (install + doctor)

Apply colors to the existing `checkLine`/`failLine`/`infoLine` helpers:
- `✓` → green
- `✗` → red
- `○` → yellow for warnings, dim for info
- Remediation arrows `→` → dim

Currently these are plain strings. Add color-aware variants or make the existing helpers accept a `Colors` object.

### 2. Section headers in doctor output

Group doctor results into logical sections:
```
  Codex CLI
  ✓ v0.116.0 (exec supported)
  ✓ Authenticated

  Model
  ○ Using Codex default (no override)

  Skill
  ✓ Installed (v0.1.0) at .claude/skills/opinionate/SKILL.md

  Binary
  ✓ /usr/local/bin/opinionate
```

### 3. Better install header with color

```
╭─────────────────────╮
│  opinionate v0.1.0  │  ← cyan border, bold white title
╰─────────────────────╯
```

### 4. Deliberation run — context summary before first round

After the header, show what context is being sent:
```
  Files: 3 (2 inline, 1 reference)
  Git log: 20 commits
  Session: resuming 20260323-151422-k4x9pt
```

### 5. Deliberation run — visual separators between rounds

Add a thin dim separator line between rounds:
```
◐ Round 1/3: sending context to peer...
✓ Round 1/3: complete (42s)

  ─────────────────────────

◐ Round 2/3: sending context to peer...
```

### 6. Wire heartbeat through the reporter

The heartbeat timer in `codex-cli.ts` currently emits through `trace.emitVerbose()`. Wire it through the reporter's `emitRoundWaiting()` method so users see styled waiting lines even in non-verbose mode (since waiting 30s+ with no output is the #1 confusion point).

### 7. Colored box renderer

`renderBox()` currently returns plain Unicode. Add a `renderColorBox()` that applies:
- Cyan border characters
- Bold white title text

---

## Files to modify

- `src/util/format.ts` — colored box, colored status line helpers
- `src/util/terminal-reporter.ts` — context summary, round separators, wired heartbeat
- `src/core/preflight.ts` — grouped doctor output with section headers and colors
- `src/cli.ts` — colored install output, pass reporter to adapter for heartbeat
- `src/adapters/codex-cli.ts` — emit heartbeat through reporter instead of just trace
- `src/__tests__/format.test.ts` — test colored helpers
- `src/__tests__/terminal-reporter.test.ts` — test new reporter methods
- `src/__tests__/cli.test.ts` — verify install/doctor colored output

---

## Non-Goals

- Animated spinners or progress bars (breaks CI/piped output)
- Full-screen TUI
- Custom themes
- Changes to stdout JSON format
