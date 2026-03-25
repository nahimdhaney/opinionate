---
name: opinionate
description: Use automatically when a task is complex enough to benefit from a second opinion: architecture trade-offs, multi-file changes, deep reviews, debugging dead-ends, or decision-heavy work. For plans/docs, Claude can iterate with Codex across persisted sessions; manual approval is the default, and automatic plan/doc updates are opt-in only.
---

# Opinionate — Multi-Agent Deliberation

This skill uses `opinionate` to get a second opinion from Codex before acting.

Claude should invoke it automatically for sufficiently complex tasks. Do not wait for the user to type `/opinionate` when the task clearly benefits from Codex's view.

For normal deliberation, Claude runs the CLI and presents the result.

For **plans and docs**, Claude can also run a live multi-pass loop:

- Codex reviews the current artifact
- Claude interprets the findings
- Claude either proposes edits for approval or applies plan/doc edits directly if the user explicitly authorized automatic mode
- Claude continues the session for another round

Source file in this repo: `skill/opinionate/skill.md`

Installed project path: `.claude/skills/opinionate/SKILL.md`

## When to Use

- **Planning**: architecture plans, rollout plans, specs, docs
- **Review**: a plan, PR approach, tricky implementation, or design decision needs a second opinion
- **Debug**: you are stuck, have conflicting hypotheses, or want another line of reasoning
- **Decide**: you need to compare concrete options with trade-offs
- **Complex delivery work**: multi-file changes, risky behavior changes, unclear requirements, or tasks where a single-agent answer is likely to miss an important angle

Use your judgment. For simple tasks, skip it.

## Default Trigger Rule

Invoke opinionate automatically when the task is complex enough that Codex's view is likely to improve the result.

Strong signals:

- architecture or rollout trade-offs
- multi-file or cross-module changes
- non-trivial reviews where correctness matters
- debugging dead-ends or conflicting hypotheses
- ambiguous tasks where Claude is making a meaningful judgment call
- work the user explicitly asks to make thorough, careful, or decision-grade

Default behavior:

- if the task is clearly complex, invoke opinionate without asking for permission first
- briefly tell the user you are bringing in Codex as part of the workflow
- if the task is simple or mechanical, do not invoke it
- if the user explicitly says not to use opinionate or not to consult Codex, do not invoke it

The slash command `/opinionate` is still the explicit override when the user wants to force deliberation.

## Setup Check

First make sure the project has been onboarded:

```bash
opinionate install
```

If the peer agent still does not run:

```bash
opinionate doctor --cwd "<project working directory>"
```

Use the doctor output before retrying.

## Choose the Workflow

Decide between two workflows before running anything.

### 1. Standard deliberation

Use this for:

- complex tasks in any mode where a second opinion is worthwhile
- code review where you only want recommendation output
- debugging and decisions that should not mutate files
- cases where a single `run` is enough

### 2. Live plan/doc deliberation

Use this only when the primary artifact is an eligible plan/doc file:

- `*.md`
- `*.mdx`
- `*.txt`
- `docs/**`
- `plans/**`
- `specs/**`

This workflow is **plans/docs only** in v2a.

Do **not** use automatic editing for source code.

## Interaction Modes For Live Plan/Doc Deliberation

### Manual mode (default)

Manual mode is the default.

Claude may:

- run one deliberation round
- interpret Codex's findings
- propose plan/doc edits

Claude must **not** apply those edits until the user approves.

### Automatic mode (opt-in only)

Automatic mode is only allowed when the user explicitly authorizes it in the conversation, for example:

- "Use automatic mode"
- "Auto-apply the plan changes"
- "Let opinionate update the plan between rounds"

In automatic mode, Claude may apply edits between rounds, but only to eligible plan/doc files.

Automatic mode must not be used for code in v2a.

## Standard Deliberation

Use Bash to invoke the CLI:

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
  --file-strategy auto \
  --verbose \
  --show-peer-command \
  --retry-on-timeout
```

Parse the JSON result from stdout and present it to the user.

## Live Plan/Doc Deliberation

For the live loop, use **one round per CLI invocation**.

Each one-round live-loop invocation is treated as terminal for that CLI call, so the peer is expected to return a structured verdict:

```markdown
**Verdict:** AGREE or DISAGREE
**Decision:** ...
**Details:** ...
```

### Step 1: Start the session

```bash
opinionate run \
  --mode <plan|review|decide> \
  --task "<what should be reviewed or improved>" \
  --cwd "<project working directory>" \
  --files "<relevant plan/doc files>" \
  --max-rounds 1 \
  --persist-session \
  --reasoning-effort medium \
  --file-strategy auto \
  --verbose \
  --retry-on-timeout
```

### Step 2: Read the result

Use these fields first:

- `agreed`
- `peerPosition`
- `keyDisagreements`
- `summary`
- `sessionId`
- `sessionMemory`

The transcript is fallback context only. Do not rely on `transcript[-1]` as the primary contract.
Treat `agreed` as the authoritative stop/go signal for the live loop.

### Step 3: Decide what to do next

If `agreed === true`:

- stop the loop immediately
- present the final state to the user
- do not keep iterating just because the cap has not been reached

The round cap is only a safety limit, not a target.

If `agreed === false`:

- derive the concrete plan/doc changes Claude wants to make
- summarize what Codex is objecting to
- decide whether to continue in manual mode or automatic mode

### Step 4A: Manual mode behavior

In manual mode, Claude should:

1. summarize Codex's findings
2. propose the exact plan/doc edits
3. ask for approval before applying them

Use copy like:

```text
Codex raised 3 issues. I have a concrete revision to the plan that addresses them.
Apply those changes and continue the deliberation? [y/n]
```

If approved:

- edit the plan/doc files
- continue the session

If declined:

- stop and wait for user direction

### Step 4B: Automatic mode behavior

Only if the user explicitly enabled automatic mode:

- apply the eligible plan/doc edits directly
- summarize what changed
- continue the session

### Step 5: Continue the session

```bash
opinionate continue \
  --session <sessionId> \
  --mode <mode> \
  --task "Addressed: <summary of changes>. Remaining: <open items>" \
  --cwd "<project working directory>" \
  --files "<updated plan/doc files>" \
  --max-rounds 1 \
  --reasoning-effort medium \
  --file-strategy auto \
  --verbose \
  --retry-on-timeout
```

### Step 6: Stop conditions

Stop when any of these are true:

1. `agreed === true`
2. 5 round-trips have been reached
3. the user declines the edits in manual mode
4. the user interrupts or redirects the task
5. there is no meaningful next revision to make

## Parsing and Presenting Results

### When agreed

```text
## Deliberation Complete ({rounds} rounds, agreed)

### Decision
{result.decision}

### Summary
{result.summary}

### Peer Position
{result.peerPosition}
```

For live plan/doc deliberation, also describe:

- whether manual or automatic mode was used
- what changed between rounds
- which artifact version Codex ultimately agreed with

### When inconclusive

```text
## Deliberation Inconclusive ({rounds} rounds, no agreement)

### Recommended Path
{result.recommendedPath}

### Peer Position
{result.peerPosition}

### Key Disagreements
{bullet list from result.keyDisagreements}
```

## Example: Manual Plan Loop

```text
User: "Review my pricing plan"

Round 1:
  Run `opinionate run ... --max-rounds 1 --persist-session`
  Codex raises issues about trust boundary and decimals
  Claude proposes updates to the plan
  Claude asks: "Apply those changes and continue? [y/n]"

Round 2:
  After approval, Claude edits the plan
  Run `opinionate continue --session <id> ... --max-rounds 1`
  Codex reviews the revised plan

Round 3:
  Codex agrees
  Claude stops immediately and presents the final revised plan
```

## Example: Automatic Plan Loop

```text
User: "Use automatic mode and keep iterating on the rollout plan"

Round 1:
  Claude runs one round
  Codex raises issues
  Claude updates the plan automatically

Round 2:
  Claude continues the session with the revised file
  Codex reviews again

Round 3:
  Codex agrees
  Claude stops and presents the final revised plan plus the change summary
```

## Error Handling

If the CLI exits with an error:

```text
Deliberation failed: {error message}
Would you like to proceed without deliberation, or resolve the issue first?
```

If the user asks what Codex actually did, rerun with `--verbose` and, when needed, `--trace-dir <path> --show-peer-command`.

If the run is slow on a large plan or spec, prefer `--reasoning-effort medium` and keep `--file-strategy auto` so Codex reads large docs from disk instead of receiving them inline.
