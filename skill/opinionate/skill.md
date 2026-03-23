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

If the command fails or the peer agent does not run, first execute:

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
  --verbose \
  --show-peer-command
```

### Choosing the mode

- `plan` — You need to decide HOW to implement something
- `review` — Code has been written and needs a second opinion
- `debug` — You're stuck and need hypotheses
- `decide` — There's a concrete choice to make (library, pattern, API design)

### Building context

- `--task`: A 1-2 sentence description of the deliberation topic
- `--files`: Include files most relevant to the decision (the peer has no prior context)
- `--conversation-summary`: Summarize what the user wants and any constraints discussed
- `--git-log`: Include when recent changes are relevant to the discussion
- `--verbose`: Show round lifecycle and peer execution metadata on stderr
- `--trace-dir`: Persist per-round JSON artifacts when the user wants a durable trace
- `--show-peer-command`: Print the exact Codex command line
- `--show-peer-output`: Stream Codex stdout/stderr back to stderr when requested

## Parsing the Result

The CLI outputs a JSON `DeliberationResult` to stdout. Parse it and present to the user:

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
- **Restart with guidance**: Run `opinionate run` again, prepending the user's guidance
  to the `--task` flag. Each deliberation is stateless — there is no resume.

## Error Handling

If the CLI exits with an error (e.g., Codex not installed, timeout), inform the user:

```
Deliberation failed: {error message}
Would you like to proceed without deliberation, or resolve the issue first?
```

If the user asks what Codex actually did, rerun with `--verbose` and, when needed, `--trace-dir <path> --show-peer-command`.
