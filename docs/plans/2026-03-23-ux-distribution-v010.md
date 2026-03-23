# Opinionate v0.1.0: UX, Distribution, and Release Polish

**Date:** 2026-03-23
**Status:** Draft
**Session:** `20260323-201953-m5d8iq`
**Motivation:** Opinionate has all the core features (deliberation engine, sessions, DX resilience) but the terminal experience during execution is minimal, the README assumes insider knowledge, and there is no published npm package or documented update path. This plan hardens the product for its first public release.

---

## Guiding Principle

Treat v0.1.0 as a **release-hardening pass**, not a new feature wave. The existing code has the right seams — the goal is to make the experience legible, predictable, and installable by someone who has never seen the project before.

---

## Area 1: Terminal UX During Deliberation

### Current state

Today, a non-verbose `run` prints exactly one line per round to stderr:

```
Starting deliberation: mode=plan, maxRounds=5, peer=codex-cli
Deliberating... Round 1/5 complete.
```

Then JSON on stdout. With `--verbose`, the heartbeat and lifecycle events appear — but they are unstyled, unprefixed, and mixed in with raw diagnostic noise. There is no visual distinction between "waiting", "retrying", "agreed", or "error".

### Problem

- A 2-minute wait with no feedback is indistinguishable from a hang
- Non-verbose output is too thin — the user cannot tell what state the tool is in
- Verbose output is a firehose — useful for debugging, but not for normal human use
- No color, no structure, no visual hierarchy between round phases

### Design

Add a `TerminalReporter` that subscribes to structured events from `ExecutionTrace` and renders them as styled, deterministic lines on stderr. Keep the existing `ExecutionTrace` as the event bus; the reporter is a consumer.

**Do not** build a full-screen TUI (curses, blessed, ink). For v0.1.0, use line-based progress that works in every terminal, CI system, and log file.

**Visual language:** Reuse the install/doctor style from `src/util/format.ts` as the base:

| State | Color | Symbol | Example |
|-------|-------|--------|---------|
| Header | white/bold | `╭─╮` box | `╭─ opinionate ─ plan ─ 5 rounds max ─╮` |
| Starting | cyan | `◐` | `◐ Round 1/5: sending context to peer...` |
| Waiting | yellow/dim | `◑` | `◑ Round 1/5: waiting... 30s elapsed, no output yet` |
| Retrying | yellow | `↻` | `↻ Round 1/5: timed out, retrying with reference files...` |
| Round done | green | `✓` | `✓ Round 1/5: complete (42s, agreed)` |
| Inconclusive | yellow | `○` | `○ Round 3/3: inconclusive — key disagreements remain` |
| Error | red | `✗` | `✗ Round 2/5: peer timed out after 300s` |
| Partial | yellow | `◔` | `◔ Round 2/5: partial response recovered (2.1KB)` |
| Result | green/bold | `✓` | `✓ Deliberation complete: agreed in 2 rounds (84s)` |
| Result | yellow/bold | `○` | `○ Deliberation inconclusive after 5 rounds (312s)` |
| Session | dim | `↳` | `↳ Session persisted: 20260323-201953-m5d8iq` |

**Color rules:**
- Respect `NO_COLOR` env var and `!stderr.isTTY` — fall back to plain text with symbols only
- Use ANSI escape codes directly (no dependency) — the palette is small enough
- Keep all UX on stderr; stdout stays reserved for JSON

### Task 1A: Add ANSI color utilities to `src/util/format.ts`

**Files:**
- Modify: `src/util/format.ts`

Add a small set of color helpers gated on `NO_COLOR` and TTY detection:

```typescript
export interface ColorSupport {
  enabled: boolean;
}

export function detectColorSupport(stream?: { isTTY?: boolean }): ColorSupport {
  if (process.env.NO_COLOR !== undefined) return { enabled: false };
  if (process.env.FORCE_COLOR !== undefined) return { enabled: true };
  return { enabled: !!(stream ?? process.stderr).isTTY };
}

export function createColors(support: ColorSupport) {
  const wrap = (code: string, reset: string) =>
    support.enabled ? (text: string) => `\x1b[${code}m${text}\x1b[${reset}m` : (text: string) => text;

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
```

Keep the existing `renderBox`, `checkLine`, `failLine`, `infoLine` functions. They already work without color — enhance them later if desired.

### Task 1B: Create `src/util/terminal-reporter.ts`

**Files:**
- Create: `src/util/terminal-reporter.ts`

The reporter wraps a `CliIO` stderr sink and exposes methods for each deliberation lifecycle event:

```typescript
export interface TerminalReporterOptions {
  stderr: (chunk: string) => void;
  verbose: boolean;
  mode: string;
  maxRounds: number;
  colorSupport?: ColorSupport;
}

export class TerminalReporter {
  // Called once at deliberation start
  emitHeader(): void

  // Round lifecycle
  emitRoundStart(round: number): void
  emitRoundWaiting(round: number, elapsedSec: number, stdoutBytes: number, stderrBytes: number): void
  emitRoundRetry(round: number, reason: string): void
  emitRoundPartial(round: number, contentLength: number): void
  emitRoundComplete(round: number, durationMs: number, agreed: boolean): void
  emitRoundError(round: number, message: string): void

  // Verbose-only diagnostics (peer lifecycle, prompt size, etc.)
  emitDiagnostic(round: number, message: string): void

  // Final result
  emitResult(agreed: boolean, rounds: number, totalDurationMs: number): void
  emitSessionPersisted(sessionId: string): void
  emitSessionResumed(sessionId: string): void
}
```

The reporter does not own any execution logic — it only formats and prints. This keeps it testable and decoupled from the deliberation engine.

### Task 1C: Wire the reporter into `src/cli.ts`

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/core/execution-trace.ts`

Replace the ad-hoc `log(io, ...)` calls in `runDeliberationCommand` with reporter methods. The `onRoundComplete` callback and the heartbeat in `codex-cli.ts` should emit through the reporter.

**Key change:** The default (non-verbose) UX should now show:
1. A compact header box with mode, max rounds, and model source
2. A round-start line when each round begins
3. The heartbeat every 15s (already exists in the adapter, just needs styling)
4. A round-complete line with duration and agreement status
5. A final result line

The `--verbose` flag adds diagnostics (prompt size, peer lifecycle, MCP events) below the corresponding round lines.

### Task 1D: Tests

**Files:**
- Create: `src/__tests__/terminal-reporter.test.ts`
- Modify: `src/__tests__/format.test.ts`

Test:
- Color output when `FORCE_COLOR` is set
- Plain output when `NO_COLOR` is set
- Each lifecycle method produces the expected symbol and text
- Verbose diagnostics appear only when verbose is true

---

## Area 2: README Overhaul

### Current state

The README is comprehensive but written for someone who already understands the tool. It mixes internal development instructions with user-facing docs. The banner references `assets/banner.svg` which is not published to npm.

### Problem

- No clear "what is this and why should I care" for a first-time visitor
- Quick Start uses `npm install opinionate` but the package is not published yet
- The banner will be a broken image on npm because `assets/` is not in `files`
- Development and testing instructions are mixed with usage docs
- No explicit "this is v0.1.0" framing or stability expectations

### Task 2A: Rewrite README for external audience

**Files:**
- Modify: `README.md`

Structure:

1. **Banner and tagline** — use an absolute GitHub raw URL for the banner so it works on npm too
2. **What is opinionate** — 2-3 sentences for someone who has never heard of it
3. **Who is it for** — Claude Code users, Codex users, anyone who wants multi-agent deliberation
4. **Prerequisites** — Node >= 18, Codex CLI, Codex authenticated
5. **Install** — `npm install -g opinionate` as the primary path, `npx` as the zero-install alternative
6. **Setup** — `opinionate install` in your project, then restart Claude Code
7. **First deliberation** — a complete working example with expected output
8. **How it works** — the existing architecture diagram (keep it)
9. **Usage lanes:**
   - "With Claude Code" — short, focused on the `/opinionate` trigger
   - "As a standalone CLI" — full flag reference
10. **Sessions** — the existing stateful sessions section (keep it)
11. **Troubleshooting** — keep the existing section, add "package not found" and "stale skill" entries
12. **Configuration** — model resolution, reasoning effort, file strategy
13. **Stability** — "v0.1.0: CLI flags are additive, JSON output is stable within 0.1.x"
14. **Contributing** — short, link to issues
15. **License** — MIT

Move "Local Development", "Writing a Custom Adapter", and "Library API" to a separate `docs/DEVELOPMENT.md` or collapse them under a "For contributors" heading at the bottom.

### Task 2B: Fix banner asset path

**Files:**
- Modify: `README.md`
- Modify: `package.json` (if we choose to publish `assets/`)

Option A: Switch the banner `src` to an absolute GitHub raw URL:
```html
<img src="https://raw.githubusercontent.com/<owner>/opinionate/main/assets/banner.svg" />
```

Option B: Add `"assets"` to the `files` array in `package.json`.

Prefer Option A — it avoids shipping image files in the npm tarball.

---

## Area 3: Distribution and Versioning

### Current state

`package.json` has `"version": "0.1.0"`, a `bin` entry, and `files: ["dist", "skill"]`. But the package has never been published to npm. There is no `repository`, `homepage`, or `bugs` field. There is no documented update path.

### Problem

- Users cannot install the tool at all right now (it's not on npm)
- There is no documented way to update after the initial install
- The skill file invokes `opinionate run` but the user may have installed via `npx` — the binary may not be on PATH
- No prepublish checks or release checklist

### Task 3A: Add npm package metadata

**Files:**
- Modify: `package.json`

Add:

```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/<owner>/opinionate.git"
  },
  "homepage": "https://github.com/<owner>/opinionate",
  "bugs": {
    "url": "https://github.com/<owner>/opinionate/issues"
  },
  "author": "<name>",
  "publishConfig": {
    "access": "public"
  }
}
```

### Task 3B: Add prepublish build check

**Files:**
- Modify: `package.json`

Add a `prepublishOnly` script:

```json
{
  "scripts": {
    "prepublishOnly": "pnpm build && pnpm test"
  }
}
```

This prevents publishing a broken package.

### Task 3C: Document the three install paths

**Files:**
- Modify: `README.md`

```bash
# Zero-install trial (runs from npm cache, no global install)
npx opinionate@latest install

# Global install (recommended for frequent use)
npm install -g opinionate
opinionate install

# Project-local (pinned version)
npm install -D opinionate
npx opinionate install
```

### Task 3D: Document the update path

**Files:**
- Modify: `README.md`

```bash
# Update global install
npm install -g opinionate@latest
opinionate install   # refreshes the skill

# Update project-local
npm update opinionate
npx opinionate install

# Zero-install always uses latest
npx opinionate@latest install
```

Make it explicit: `opinionate install` should be re-run after updating to refresh the skill file.

### Task 3E: Add a publish checklist to `docs/`

**Files:**
- Create: `docs/RELEASE.md`

```markdown
# Release Checklist

1. Update `version` in `package.json`
2. Run `pnpm build && pnpm test` — all must pass
3. Update `CHANGELOG.md` (if it exists)
4. Commit: `git commit -m "release: v0.x.y"`
5. Tag: `git tag v0.x.y`
6. Publish: `npm publish`
7. Push: `git push && git push --tags`
8. Verify: `npx opinionate@latest doctor`
```

### Task 3F: Versioning policy for 0.1.x

Document in README under a "Stability" section:

- CLI flags are additive within 0.1.x — existing flags won't be removed or change meaning
- `DeliberationResult` JSON shape is stable within 0.1.x — new fields are additive only
- The installed skill contract (`SKILL.md`) may evolve — re-run `opinionate install` after updates
- Session storage format (`.opinionate/sessions/`) may change between minor versions

---

## Area 4: First-Run Experience and Onboarding

### Current state

`opinionate install` already does skill installation + doctor check in one command. The output is functional but plain:

```
╭─────────────────────────────────────────╮
│  opinionate - multi-agent deliberation  │
╰─────────────────────────────────────────╯

Installing skill...

  ✓ Skill installed to ...

Checking environment...

  ✓ Codex CLI: v0.116.0 (exec supported)
  ...
```

### Problem

- After install succeeds, the user's next action isn't obvious enough — "restart Claude Code" is buried in a list
- No "try it now" example
- No stale-skill detection — if a user updates opinionate but doesn't re-run `install`, the old `SKILL.md` stays
- Error messages on failed `run` are generic — they don't suggest specific remediation

### Task 4A: Improve install success output

**Files:**
- Modify: `src/cli.ts` (the `runInstallCommand` function)

After all checks pass, print a styled "next steps" block:

```
╭─────────────────────────────────────────╮
│  opinionate v0.1.0 — ready             │
╰─────────────────────────────────────────╯

  ✓ Skill installed
  ✓ Codex CLI authenticated
  ✓ Environment checks passed

  Next:
    1. Restart your Claude Code session in this project
    2. Try: opinionate run --mode plan --task "hello world" --verbose

  Update later with:
    npm install -g opinionate@latest && opinionate install
```

Use the color utilities from Task 1A to style the output when the terminal supports it.

### Task 4B: Embed a version marker in the installed skill

**Files:**
- Modify: `skill/opinionate/skill.md`
- Modify: `src/install.ts`
- Modify: `src/core/preflight.ts`

Add a version comment at the top of the installed `SKILL.md`:

```markdown
<!-- opinionate-skill-version: 0.1.0 -->
```

At install time, `src/install.ts` reads the version from `package.json` and writes it into the comment.

In `preflight.ts` (doctor), read the installed skill and compare the embedded version to the package version. If they differ:

```
  ⚠ Skill: installed (v0.0.1) but outdated — run `opinionate install` to update
```

### Task 4C: Actionable error remediation on failed `run`

**Files:**
- Modify: `src/cli.ts` (the `runDeliberationCommand` function)

When a `DeliberationError` is caught, map the error code to a specific remediation message:

| Error code | Remediation |
|-----------|-------------|
| `ADAPTER_UNAVAILABLE` | `Codex CLI not found. Run: npm install -g @openai/codex` |
| `ADAPTER_TIMEOUT` | `Peer timed out. Try: --reasoning-effort medium --retry-on-timeout` |
| `ADAPTER_ERROR` (auth) | `Codex auth failed. Run: codex login` |
| `ADAPTER_ERROR` (other) | `Peer error. Run with --verbose --show-peer-output for details` |

Print the remediation below the error message on stderr.

### Task 4D: Tests

**Files:**
- Modify: `src/__tests__/cli.test.ts`
- Modify: `src/__tests__/preflight.test.ts`
- Modify: `src/__tests__/install.test.ts`

Test:
- Stale skill version triggers a doctor warning
- Install embeds the correct version marker
- Error remediation messages appear for each error code

---

## Implementation Order

| Priority | Task | Area | Impact | Effort |
|----------|------|------|--------|--------|
| 1 | 1A | Color utilities | Foundation | Low |
| 2 | 1B | Terminal reporter | High — user-visible | Medium |
| 3 | 1C | Wire reporter into CLI | High — user-visible | Medium |
| 4 | 4A | Install success output | High — first impression | Low |
| 5 | 4B | Stale skill detection | Medium — prevents confusion | Low |
| 6 | 4C | Actionable error remediation | Medium — reduces frustration | Low |
| 7 | 3A | Package metadata | Required for publish | Low |
| 8 | 3B | Prepublish check | Required for publish | Low |
| 9 | 2A | README rewrite | High — public face | Medium |
| 10 | 2B | Banner fix | Low — cosmetic | Low |
| 11 | 3C-3D | Install/update docs | Medium — user onboarding | Low |
| 12 | 3E | Release checklist | Medium — process | Low |
| 13 | 3F | Versioning policy | Low — sets expectations | Low |
| 14 | 1D, 4D | Tests | Required | Medium |

---

## Testing Strategy

Each task should include unit tests in `src/__tests__/` following existing vitest patterns:

1. **For 1A:** Test color output with `FORCE_COLOR`, plain with `NO_COLOR`, auto-detect with mock `isTTY`
2. **For 1B:** Test each reporter method produces expected symbol, text, and color codes; test verbose vs non-verbose gating
3. **For 1C:** Integration test that a mock deliberation run produces the expected stderr sequence
4. **For 4B:** Test that install writes the version marker and doctor detects version mismatch
5. **For 4C:** Test that each error code maps to the correct remediation message

---

## Non-Goals

- Full-screen TUI (curses, blessed, ink) — line-based progress is sufficient for v0.1.0
- Animated spinners or progress bars — they don't work well in CI or piped output
- Auto-update mechanism — users update manually with npm
- Windows-specific terminal handling — ANSI codes work in modern Windows Terminal; no special casing
- Custom themes or user-configurable color schemes
- Breaking changes to stdout JSON format or CLI flag semantics

---

## Risks and Mitigations

### Risk: Color codes break CI/log output

Mitigation: Gate all color on `stderr.isTTY && !NO_COLOR`. Plain text fallback uses Unicode symbols only — they render correctly without color support.

### Risk: Reporter adds too many lines to non-verbose output

Mitigation: Non-verbose shows only: header, round start, round complete, final result. That's at most `2 + 2*rounds` lines for a typical run. Heartbeat lines only appear with `--verbose`.

### Risk: npm publish goes wrong on first attempt

Mitigation: `prepublishOnly` runs build + test. Release checklist documents the exact sequence. First publish can be done with `--dry-run` to verify the tarball contents.

### Risk: Stale skill detection false-positives during development

Mitigation: Only warn when both versions are valid semver and they differ. During development (no version marker in skill), skip the check.

---

## Expected Outcome

After this plan ships:

1. A user who has never seen opinionate can `npm install -g opinionate && opinionate install` and have a working setup in under 3 minutes
2. During a deliberation, the terminal shows clear, styled progress — the user always knows what round they're in, how long it's been, and what happened
3. The README makes sense to an outsider and matches the actual install/usage flow
4. The package is published on npm with proper metadata, and the update path is documented
5. Errors tell the user what to do, not just what went wrong
