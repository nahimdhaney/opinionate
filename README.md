<p align="center">
  <img src="https://raw.githubusercontent.com/nahimdhaney/opinionate/main/assets/banner.svg" alt="opinionate" width="800" />
</p>

# opinionate

**Get a second opinion before you commit.** Opinionate runs structured multi-round deliberations between your AI coding agent and a peer, so you make better decisions on plans, reviews, and architecture.

> v0.1.0 — CLI flags are additive, JSON output is stable within 0.1.x.

## What Is This?

Opinionate is a CLI tool and Claude Code skill that orchestrates a structured debate between two AI agents — your primary agent (Claude) and a peer (Codex CLI). Instead of trusting one model's first instinct, you get a deliberated recommendation with full transparency into the reasoning.

**Who is it for:**
- Claude Code users who want a second opinion on complex decisions
- Developers who use Codex CLI and want structured peer review
- Anyone building multi-agent workflows

## Prerequisites

- **Node.js** >= 18
- **[Codex CLI](https://github.com/openai/codex)** installed globally: `npm install -g @openai/codex`
- **Codex authenticated**: `codex login`

## Install

```bash
# Global install (recommended)
npm install -g opinionate

# Or zero-install trial
npx opinionate@latest install
```

Then set up your project:

```bash
cd /path/to/your-project
opinionate install
```

Install runs through each step sequentially so you can see exactly what's happening:

```
╭─────────────────────╮
│  opinionate v0.1.0  │
╰─────────────────────╯

1. Installing skill...
   ✓ Skill installed to .claude/skills/opinionate/SKILL.md

2. Checking Codex CLI...
   ✓ v0.116.0 (exec supported)

3. Testing Codex auth...
   ✓ Authenticated

4. Checking configuration...
   ○ Model: Codex default
   ✓ Binary: /usr/local/bin/opinionate

All checks passed.
```

Restart your Claude Code session afterward.

## Quick Start

### With Claude Code

After installing, restart Claude Code in your project. Claude will invoke opinionate automatically when facing complex decisions, or you can trigger it:

```
/opinionate
```

Automatic invocation is the default for complex work, not just explicit slash-command usage. Good trigger cases include:

- architecture or rollout trade-offs
- multi-file or cross-module changes
- deep reviews where correctness matters
- debugging dead-ends or conflicting hypotheses
- ambiguous tasks where the agent is making a meaningful judgment call

If the task is simple or mechanical, Claude should skip opinionate. If you want to force deliberation anyway, use `/opinionate`.

For plans and specs, opinionate can also run as a **live multi-pass loop**:

- **manual mode** is the default: Claude proposes plan/doc edits, waits for approval, then continues the session
- **automatic mode** is opt-in only: Claude may apply plan/doc edits between rounds

In v2a, that live loop is limited to plans/docs. Code editing remains out of scope.

### As a CLI

```bash
opinionate run \
  --mode plan \
  --task "Design the authentication system for our API" \
  --files "src/auth.ts,src/middleware.ts" \
  --reasoning-effort medium \
  --verbose \
  --retry-on-timeout
```

**stdout** is always machine-readable JSON. **stderr** shows styled progress:

```
╭──────────────────────────────────────────────────────╮
│  opinionate · plan · 5 rounds max · peer: codex-cli  │
╰──────────────────────────────────────────────────────╯

  Files: 3 (2 inline, 1 by path)
  Git log: included

◐ Round 1/5: sending context to peer...
◑ Round 1/5: still thinking... 45s
○ Round 1/5: complete (1m12s)

  ─────

◐ Round 2/5: sending context to peer...
✓ Round 2/5: complete (42s, agreed)

✓ Deliberation complete: agreed in 2 rounds (1m54s)
  ↳ Session persisted: 20260324-151422-k4x9pt
```

With `--verbose`, you also see payload sizes, peer model info, MCP diagnostics, and detailed heartbeat stats.

## How It Works

```
┌──────────┐                              ┌──────────┐
│          │  1. task + context            │          │
│  Claude  │ ──────────────────────────►   │ opinion- │
│  (host)  │                              │ ate      │
│          │  4. DeliberationResult (JSON) │          │
│          │ ◄──────────────────────────   │          │
└──────────┘                              └─────┬────┘
                                                │
                             2. orchestrator     │     3. peer
                                prompt           │     response
                                                ▼
                                          ┌──────────┐
                                          │  Codex   │
                                          │  CLI     │
                                          └──────────┘
```

1. Claude invokes `opinionate run` via the installed skill
2. The engine sends structured prompts to Codex
3. Codex responds with its analysis
4. The engine evaluates agreement, iterates if needed, and returns a result
5. Claude presents the outcome for your approval

## CLI Reference

```
opinionate run [options]         Start a new deliberation
opinionate continue [options]    Resume a persisted session
opinionate doctor [options]      Check environment readiness
opinionate install               Install skill + run doctor
```

### Modes

| Mode | Use When |
|------|----------|
| **plan** | Before implementation — explore approaches and trade-offs |
| **review** | After writing code — get a second opinion on correctness |
| **debug** | When stuck — brainstorm hypotheses and debugging strategies |
| **decide** | Facing a choice — weigh options for libraries, patterns, APIs |

### Key Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--mode` | `plan`, `review`, `debug`, `decide` | *required* |
| `--task` | What to deliberate on | *required* |
| `--files` | Comma-separated file paths for context | — |
| `--reasoning-effort` | `low`, `medium`, `high`, `xhigh` | Codex config |
| `--file-strategy` | `auto`, `inline`, `reference` | `auto` |
| `--retry-on-timeout` | Retry timed-out rounds with reduced context | `false` |
| `--persist-session` | Save session for later `continue` | `false` |
| `--session` | Session id for `continue` | — |
| `--verbose` | Show round lifecycle on stderr | `false` |
| `--timeout` | Per-round timeout in ms | `60000` |
| `--max-rounds` | Max deliberation rounds | `5` |
| `--model` | Override Codex model | Codex default |
| `--git-log` | Include recent commits as context | `false` |
| `--trace-dir` | Write per-round JSON artifacts | — |
| `--show-peer-command` | Print exact Codex command | `false` |
| `--show-peer-output` | Stream raw Codex output | `false` |
| `--cwd` | Working directory | `.` |
| `--context-budget` | Max context size in bytes | `50000` |

## Stateful Sessions

For iterative workflows, persist sessions across runs:

```bash
# First pass
opinionate run \
  --persist-session \
  --mode plan \
  --task "Review this architecture" \
  --files "docs/plans/arch.md"
# => sessionId: 20260323-151422-k4x9pt

# After revisions
opinionate continue \
  --session 20260323-151422-k4x9pt \
  --task "I addressed the coupling concern" \
  --files "docs/plans/arch.md"
```

The continuation carries forward accepted decisions, open questions, and file deltas — not the full raw transcript. Session data is stored locally under `.opinionate/sessions/`.

## Live Plan/Doc Deliberation

Opinionate can be used in two different ways:

- **standard deliberation**: run a review/plan/debug/decision session and present the result
- **live plan/doc deliberation**: iterate with Codex across multiple one-round sessions while the artifact improves between rounds

### Manual mode (default)

Manual mode is the default for the live loop.

Typical flow:

1. Claude runs one round with `--max-rounds 1 --persist-session`.
2. Codex responds with findings.
3. Claude proposes plan/doc edits.
4. You approve those edits.
5. Claude applies them and runs `opinionate continue --session <id>`.

If both agents agree before the cap is reached, the loop stops immediately. `max-rounds` is a safety limit, not a target.
Each one-round live-loop invocation is treated as terminal for that CLI call, so the peer is expected to return a structured verdict (`**Verdict:** AGREE|DISAGREE`, `**Decision:** ...`, `**Details:** ...`).

### Automatic mode (opt-in only)

Automatic mode should only be used when you explicitly authorize it in the conversation. In this mode, Claude may update eligible plan/doc files between rounds without waiting for approval at every step.

Automatic mode is limited to:

- `*.md`
- `*.mdx`
- `*.txt`
- `docs/**`
- `plans/**`
- `specs/**`

Automatic mode does **not** apply to code in v2a.

### Recommended live-loop commands

```bash
# First round
opinionate run \
  --persist-session \
  --max-rounds 1 \
  --mode plan \
  --task "Review this rollout plan" \
  --files "docs/plans/rollout.md"

# Later rounds
opinionate continue \
  --session 20260323-151422-k4x9pt \
  --max-rounds 1 \
  --mode plan \
  --task "Addressed the fallback and trust-boundary concerns" \
  --files "docs/plans/rollout.md"
```

The skill should primarily use `agreed`, `peerPosition`, `keyDisagreements`, `summary`, `sessionId`, and `sessionMemory` when driving this loop. The transcript is useful context, but not the primary control contract. `agreed` is the authoritative field for deciding whether to stop or continue.

## File Context Strategy

`--file-strategy auto` (default) inlines small source files but sends large docs/plans by path so Codex reads them from disk. This keeps prompts compact and avoids timeout issues with oversized context.

- `inline` — always embed file contents
- `reference` — always send paths only
- `auto` — smart default based on file size and type

## Model Resolution

1. `--model <name>` (highest priority)
2. `OPINIONATE_MODEL` env var
3. Codex default from `~/.codex/config.toml`

Reasoning effort follows the same pattern with `--reasoning-effort` and `OPINIONATE_REASONING_EFFORT`.

## Updating

```bash
# Global install
npm install -g opinionate@latest
opinionate install   # refresh the skill

# Project-local
npm update opinionate
npx opinionate install

# Zero-install always uses latest
npx opinionate@latest install
```

Re-run `opinionate install` after updating to refresh the skill file.

## Troubleshooting

### Codex not found

```bash
npm install -g @openai/codex
opinionate doctor
```

### Codex not authenticated

```bash
codex login
opinionate doctor
```

### Slow or timing out

Your Codex config may have `model_reasoning_effort = "xhigh"`. Try:

```bash
opinionate run --reasoning-effort medium --retry-on-timeout --verbose ...
```

### Skill not visible in Claude

Confirm `.claude/skills/opinionate/SKILL.md` exists, then restart Claude Code.

### Stale skill

If `doctor` reports a version mismatch, run `opinionate install` to refresh the skill.

## Context Safety

Opinionate filters sensitive files before sending to the peer:

**Excluded:** `.env`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, paths containing `credential` or `secret`.

**Custom:** Add a `.opinionateignore` file (`.gitignore` syntax).

## Contributing

Contributions welcome. High-impact areas:

- **New adapters** — Gemini, Ollama, Claude API
- **Agreement detection** — LLM-as-judge mode
- **Context building** — smarter relevance ranking

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for local setup.

## License

MIT
