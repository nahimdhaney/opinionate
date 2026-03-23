---
name: opinionate
description: Invoke when facing complex planning decisions, architecture choices, debugging dead-ends, code review, or any task that would benefit from a second AI opinion. Triggers structured deliberation between Claude and a peer agent (Codex CLI by default). The user can also invoke manually with /opinionate.
---

# Opinionate — Multi-Agent Deliberation

This skill runs a structured deliberation session between you (Claude) and a peer AI agent
(Codex CLI) to produce a better recommendation before acting.

Project install path: `.claude/skills/opinionate/SKILL.md`

## When to Use

- **Planning**: Before implementing a feature with multiple possible approaches
- **Review**: After writing code that touches critical paths
- **Debug**: When stuck on a problem after initial investigation
- **Decide**: When facing a technical decision with meaningful trade-offs

Use your judgment. Not every task needs deliberation — simple bug fixes and straightforward
changes don't. But when stakes are high or the path is unclear, invoke this.

## Setup Check

First make sure the project has been onboarded once:

```bash
opinionate install
```

That command installs the skill and runs the environment checks. If the peer agent still does not run, execute:

```bash
opinionate doctor --cwd "<project working directory>"
```

Use the doctor output before retrying the deliberation.

## How to Run

Use Bash to invoke the `opinionate` CLI. Construct the command from the current
conversation context:

```bash
opinionate run \
  --mode <plan|review|debug|decide> \
  --task "<brief description of what to deliberate>" \
  --cwd "<project working directory>" \
  --files "<comma-separated relevant file paths>" \
  --git-log \
  --conversation-summary "<summary of the conversation so far>" \
  --max-rounds 5 \
  --timeout 60000 \
  --reasoning-effort medium \
  --verbose \
  --show-peer-command \
  --retry-on-timeout
```

### Choosing the mode

- `plan` — You need to decide HOW to implement something
- `review` — Code has been written and needs a second opinion
- `debug` — You're stuck and need hypotheses
- `decide` — There's a concrete choice to make (library, pattern, API design)

### Building context

- `--task`: A 1-2 sentence description of the deliberation topic
- `--files`: Include files most relevant to the decision (the peer has no prior context)
- `--file-strategy`: Leave this as `auto` in most cases. Large Markdown plans/specs/docs will be passed by path so Codex can read them from disk instead of bloating the initial prompt.
- `--conversation-summary`: Summarize what the user wants and any constraints discussed
- `--reasoning-effort`: Use `medium` when you need a responsive peer. Omit it only if there is a reason to inherit Codex's configured default.
- `--git-log`: Include when recent changes are relevant to the discussion
- `--verbose`: Show round lifecycle and peer execution metadata on stderr
- `--trace-dir`: Persist per-round JSON artifacts when the user wants a durable trace
- `--show-peer-command`: Print the exact Codex command line
- `--show-peer-output`: Stream Codex stdout/stderr back to stderr when requested
- `--retry-on-timeout`: Retry once with reduced file context if a round times out
- `--persist-session`: Use on the first pass when you expect the user to revise a plan or code and come back for another review

## Parsing the Result

The CLI outputs a JSON `DeliberationResult` to stdout. Parse it and present to the user:

If `result.sessionId` is present, keep it available for follow-up passes. That means the deliberation was started with `--persist-session` and can be resumed with `opinionate continue --session <id>`.

### When agreed (agreed: true)

```
## Deliberation Complete ({rounds} rounds, agreed)

### Decision
{result.decision}

### Summary
{result.summary}

### Full Transcript
{format each message in result.transcript}

Approve this decision? [y/n/restart with guidance]
```

### When inconclusive (agreed: false)

```
## Deliberation Inconclusive ({rounds} rounds, no agreement)

### Recommended Path
{result.recommendedPath}

### Peer Position
{result.peerPosition}

### Key Disagreements
{bullet list from result.keyDisagreements}

### Full Transcript
{format each message in result.transcript}

How would you like to proceed? [accept recommendation / accept peer / restart with guidance]
```

## Handling User Responses

- **Approve / Accept**: Proceed with the chosen approach
- **Reject (n)**: Do not proceed, ask the user what they'd prefer
- **Revise and re-review**:
  - If there is already a `sessionId`, update the artifact and run `opinionate continue --session <id>`, passing the revised guidance in `--task`.
  - If this is the first pass and more iterations are likely, restart with `opinionate run --persist-session`.
- **Restart from scratch**: Only use a brand new `opinionate run` when the user wants a fresh deliberation with no session memory carried forward.

## Error Handling

If the CLI exits with an error (e.g., Codex not installed, timeout), inform the user:

```
Deliberation failed: {error message}
Would you like to proceed without deliberation, or resolve the issue first?
```

If the user asks what Codex actually did, rerun with `--verbose` and, when needed, `--trace-dir <path> --show-peer-command`.

If deliberation is slow on a large plan or spec, prefer `--reasoning-effort medium` and keep the default `--file-strategy auto` so the peer can read large docs from disk instead of receiving them inline.

For multi-pass plan work, prefer:

```bash
opinionate run \
  --persist-session \
  --mode plan \
  --task "<initial review>" \
  --cwd "<project working directory>" \
  --files "<relevant plans/specs>"

opinionate continue \
  --session "<previous session id>" \
  --mode plan \
  --task "<what changed and what to reassess>" \
  --cwd "<project working directory>" \
  --files "<revised plans/specs>"
```
