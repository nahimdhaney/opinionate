<p align="center">
  <img src="https://raw.githubusercontent.com/nahimdhaney/opinionate/main/assets/banner.svg" alt="opinionate" width="800" />
</p>

<h3 align="center">Two AI agents deliberate. You decide.</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/opinionate"><img src="https://img.shields.io/npm/v/opinionate.svg" alt="npm version" /></a>
  <a href="https://github.com/nahimdhaney/opinionate/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/opinionate.svg" alt="license" /></a>
  <a href="https://www.npmjs.com/package/opinionate"><img src="https://img.shields.io/npm/dm/opinionate.svg" alt="downloads" /></a>
</p>

---

Opinionate gets a **second opinion from Codex** before you commit to a plan, review, or architecture decision. It runs structured multi-round deliberations between Claude and Codex, then presents the agreed recommendation — or the disagreements — for your approval.

<p align="center">
  <img src="https://raw.githubusercontent.com/nahimdhaney/opinionate/main/assets/demo.gif" alt="opinionate demo" width="800" />
</p>

## 30-Second Setup

```bash
npm install -g opinionate
npm install -g @openai/codex
codex login

cd your-project
opinionate install
```

That's it. Restart Claude Code and you're ready.

## What Happens

```
╭─────────────────────╮
│  opinionate v0.2.0  │
╰─────────────────────╯

1. Detecting environment...
   ✓ Codex CLI v0.116.0 (exec supported)

2. Testing Codex auth...
   ✓ Authenticated

3. Setup preferences...
   ? Codex reasoning effort:
   ❯ Recommended — good balance of quality and speed
     Thorough — more careful, slower
     Maximum — deepest reasoning, may timeout
     Fast — quick, less thorough

4. Installing skill...
   ✓ Skill installed
   ✓ Config saved

All checks passed.
```

## How It Works

```
  Claude ──── task + context ────► opinionate ──── prompt ────► Codex
    ▲                                                            │
    └──── deliberated result ◄──── agreement check ◄──── response ┘
```

1. Claude sends a task to opinionate
2. Opinionate prompts Codex for a peer opinion
3. They go back and forth until they agree (or hit the round limit)
4. You get the recommendation and decide what to do

## Use With Claude Code (Primary Experience)

After `opinionate install`, Claude uses it **automatically** for complex decisions. You don't need to do anything — when Claude faces architecture trade-offs, deep reviews, or ambiguous judgment calls, it invokes opinionate behind the scenes and presents you with a clean result:

```
───────────────────────────────────────────────────────

  Getting a second opinion from Codex...

  > Mode: plan
  > Task: Design the authentication system
  > Files: 3 files
  > Rounds: up to 5

───────────────────────────────────────────────────────

  Deliberation complete — agreed in 2 rounds

  Decision
  Use JWT with refresh token rotation and a 15-minute
  access token TTL. Store refresh tokens server-side.

  > Codex's position: The token rotation approach is
  > correct. Stateless access + stateful refresh is
  > the right trade-off for this API.

  Approve this direction? [y/n/adjust]

───────────────────────────────────────────────────────
```

You can also trigger it manually with `/opinionate`.

**Good for:** architecture trade-offs, multi-file changes, deep reviews, debugging dead-ends, ambiguous judgment calls.

## Use As a CLI

```bash
opinionate run \
  --mode plan \
  --task "Design the auth system" \
  --files "src/auth.ts,src/middleware.ts" \
  --verbose
```

Output on stderr — clean, styled, real-time:

```
╭──────────────────────────────────────────────────────╮
│  opinionate · plan · 5 rounds max · peer: codex-cli  │
╰──────────────────────────────────────────────────────╯

  Files: 2 (2 inline)

◐ Round 1/5: sending context to peer...
◑ Round 1/5: still thinking... 45s
○ Round 1/5: complete (1m12s)

  ─────

◐ Round 2/5: sending context to peer...
✓ Round 2/5: complete (42s, agreed)

✓ Deliberation complete: agreed in 2 rounds (1m54s)
```

JSON result on stdout — machine-readable, stable contract.

## Modes

| Mode | When |
|------|------|
| `plan` | Before building — explore approaches |
| `review` | After writing — get a second opinion |
| `debug` | When stuck — brainstorm hypotheses |
| `decide` | Facing a choice — weigh trade-offs |

## Iterative Sessions

For plans and docs, opinionate supports **multi-pass deliberation**:

```bash
# First pass — Codex reviews your plan
opinionate run --persist-session --mode plan \
  --task "Review this rollout plan" \
  --files "docs/plans/rollout.md"

# You revise the plan based on feedback...

# Second pass — Codex reviews only what changed
opinionate continue --session <id> \
  --task "Addressed the coupling concern" \
  --files "docs/plans/rollout.md"
```

Each continuation carries forward **accepted decisions, open questions, and file deltas** — not the full transcript. Sessions stop immediately when both agents agree.

**Manual mode** (default): Claude proposes edits, you approve, then it continues.
**Automatic mode** (opt-in): Claude applies plan/doc edits between rounds. Say "use automatic mode" to enable.

## Key Flags

| Flag | What it does | Default |
|------|-------------|---------|
| `--mode` | plan, review, debug, decide | *required* |
| `--task` | What to deliberate on | *required* |
| `--files` | Comma-separated file paths | — |
| `--reasoning-effort` | low, medium, high, xhigh | config |
| `--retry-on-timeout` | Auto-retry with smaller context | false |
| `--persist-session` | Save for later `continue` | false |
| `--verbose` | Show round lifecycle details | false |
| `--timeout` | Per-round timeout (ms) | 60000 |
| `--max-rounds` | Max deliberation rounds | 5 |
| `--file-strategy` | auto, inline, reference | auto |
| `--model` | Override Codex model | Codex default |

## Configuration

`opinionate install` can save your preferences (reasoning effort, install mode) to `~/.config/opinionate/config.json`. Resolution order:

1. CLI flags (highest)
2. Environment variables (`OPINIONATE_*`)
3. User config file
4. Codex defaults

Re-run `opinionate install --reconfigure` to change preferences.

## Updating

```bash
npm install -g opinionate@latest
opinionate install    # refresh the skill
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Codex not found | `npm install -g @openai/codex` |
| Not authenticated | `codex login` |
| Slow / timing out | `--reasoning-effort medium --retry-on-timeout` |
| Skill not visible | Confirm `.claude/skills/opinionate/SKILL.md` exists, restart Claude Code |
| Stale skill | `opinionate install` |
| Usage limit | Check https://chatgpt.com/codex/settings/usage |

## Context Safety

Sensitive files are filtered before sending to the peer:

`.env`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, paths with `credential` or `secret`.

Add a `.opinionateignore` file for custom exclusions (`.gitignore` syntax).

## Contributing

High-impact areas: new adapters (Gemini, Ollama, Claude API), agreement detection, smarter context building.

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for local setup.

## License

MIT
