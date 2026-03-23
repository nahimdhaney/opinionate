# opinionate Design Review

Source: `/Users/nahimdhaney/personal/opinionate/docs/superpowers/specs/2026-03-22-opinionate-design.md`

## Findings

### 1. [P2] Human interaction assumes UI affordances that are not specified

- File: `docs/superpowers/specs/2026-03-22-opinionate-design.md:176`

The spec promises an expandable transcript, approve or reject controls, restart behavior, and real-time progress updates, but it does not define what Claude Code surface provides those interactions or what the text fallback looks like. If the v1 integration is just a skill plus terminal output, this needs an explicit output contract instead of UI assumptions.

### 2. [P1] Later rounds lose context with a fresh Codex process

- File: `docs/superpowers/specs/2026-03-22-opinionate-design.md:105`

The adapter description says each `sendMessage` call shells out to Codex CLI, while the context rules say rounds 2 and later only send the new prompt and transcript. A fresh CLI invocation will not remember the round-1 files, git log, or conversation summary, so the peer agent will deliberate on incomplete context after the first exchange. This needs either a persistent session or a resendable summarized context on every round.

### 3. [P1] The loop depends on Claude mid-flight without a defined interface

- File: `docs/superpowers/specs/2026-03-22-opinionate-design.md:117`

The core loop says the host agent formulates the next prompt and also acts as the agreement judge, but the integration section says the skill runs the package via Bash. That leaves no concrete mechanism for the package to pause after each peer response, ask Claude for the next turn, and continue. Either Claude owns the loop and the package is just a helper, or the package owns the loop and agreement detection cannot rely on Claude as an in-loop actor.

### 4. [P1] Context forwarding needs explicit safety boundaries

- File: `docs/superpowers/specs/2026-03-22-opinionate-design.md:68`

The context model allows forwarding file contents, git history, and conversation summary to the peer adapter, but the spec does not define allowlists, ignore rules, secret redaction, or user consent before that data is sent. Human approval only happens after deliberation, which is too late to prevent accidental disclosure. The plan should define what may be included by default and how sensitive context is filtered or confirmed.
