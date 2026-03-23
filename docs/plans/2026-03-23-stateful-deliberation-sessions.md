# Stateful Deliberation Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in, persistent, workspace-local opinionate sessions so a complex task can accumulate context across multiple deliberation runs instead of restarting from scratch after every document/code revision.

**Architecture:** Keep the existing inner deliberation loop and Codex process model, but add an outer session layer owned by opinionate. Persisted runs write bounded session memory, tracked file snapshots, and run metadata under `.opinionate/sessions/<id>/`; subsequent `continue` runs load that memory, compute changed-file deltas, and send Codex a compact resume payload instead of replaying the entire prior transcript.

**Tech Stack:** TypeScript, Node.js filesystem APIs, existing `Deliberation` engine, existing CLI/runtime-config system, vitest

---

## Professional Assessment

### Current gap

The current product is only stateful **inside one `opinionate run`**. The transcript is preserved across rounds in a single process, but a second run starts with a clean slate.

This is visible in the current code and docs:

- [src/core/deliberation.ts](/Users/nahimdhaney/personal/opinionate/src/core/deliberation.ts) keeps a per-run `transcript`, but it is in-memory only.
- [skill/opinionate/skill.md](/Users/nahimdhaney/personal/opinionate/skill/opinionate/skill.md) explicitly says “Each deliberation is stateless — there is no resume.”
- [2026-03-22-agent-deliberate-design.md](/Users/nahimdhaney/personal/opinionate/docs/superpowers/specs/2026-03-22-agent-deliberate-design.md) documents “restart with guidance” as a brand new invocation.
- [2026-03-22-agent-deliberate-design-review.md](/Users/nahimdhaney/personal/opinionate/docs/superpowers/specs/2026-03-22-agent-deliberate-design-review.md) already flags the missing persistent-session contract.

### Why this matters

For complex tasks, the real workflow is not one deliberation. It is:

1. Claude drafts a plan or code change.
2. opinionate gets a second opinion from Codex.
3. Claude revises the artifact.
4. opinionate should review the revision **with memory of the prior deliberation**.

Without persistent session memory, the tool only gives isolated second opinions, not compounding multi-agent work.

### Options considered

#### Option A: Keep stateless reruns and just resend more context

Rejected.

- It recreates the same prompt-bloat problem already seen with large plans.
- It wastes tokens and wall time by replaying already-settled conclusions.
- It does not model “accepted”, “rejected”, or “still open” issues.

#### Option B: Hold a long-lived Codex process open across user edits

Rejected.

- `codex exec` is already process-per-call and the current adapter model is built around that.
- A persistent subprocess would be fragile, harder to trace, and much harder to recover after errors.
- It would reduce transparency, which is one of opinionate’s main strengths.

#### Option C: Persist session memory outside Codex and resume with bounded memory plus file deltas

Recommended.

- Fits the current architecture.
- Preserves transparency and traceability.
- Gives Claude and Codex a shared, durable working memory across runs.
- Scales better than replaying the full raw transcript every time.

### Hard requirement: structured memory synthesis, not heuristic guessing

The current `DeliberationResult` does **not** contain enough structure to reliably derive:

- accepted decisions
- rejected ideas
- open questions

So v2 should not pretend `session-memory.ts` can infer those fields from free-form prose alone.

Recommended contract:

- ask the peer to include a structured session-memory block in the final round
- parse that block into an additive `sessionMemory` result field
- use light heuristics only as a fallback when the structured block is missing or malformed

This keeps the memory layer robust while preserving backward compatibility.

### Recommended product model

Opinionate should become:

- **Stateful across runs at the session layer**
- **Stateless at the peer-process layer**
- **Bounded at the prompt layer**

That means:

- each Codex call can remain a fresh process
- opinionate owns the durable memory
- continuation payloads carry summaries, unresolved issues, and changed-file deltas instead of the full historical transcript

---

## Scope

### In scope for v2

- Persistent workspace-local session storage
- Explicit opt-in session creation on `run`
- New `continue` flow for resuming a prior deliberation
- Session memory with rolling summary and unresolved issues
- Changed-file snapshotting and delta generation
- Resume-aware prompt assembly
- Additive JSON result fields for session metadata
- Claude skill and README updates for multi-pass workflows

### Out of scope for v2

- Cross-machine or cloud-synced sessions
- Persistent live Codex subprocesses
- Session branching/merging
- Automatic editing of the user’s plan/code artifact
- Full UI/browser session management

---

## File Map

### Existing files to modify

- Modify: `src/cli.ts`
- Modify: `src/core/deliberation.ts`
- Modify: `src/core/context-builder.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/runtime-config.ts`
- Modify: `src/install.ts` (only if help text or onboarding copy references new session behavior)
- Modify: `src/index.ts`
- Modify: `skill/opinionate/skill.md`
- Modify: `README.md`
- Modify: `src/__tests__/cli.test.ts`
- Modify: `src/__tests__/deliberation.test.ts`
- Modify: `src/__tests__/context-builder.test.ts`
- Modify: `src/__tests__/runtime-config.test.ts`

### New files to create

- Create: `src/core/session-store.ts`
- Create: `src/core/session-memory.ts`
- Create: `src/util/session-paths.ts`
- Create: `src/util/file-snapshot.ts`
- Create: `src/__tests__/session-store.test.ts`
- Create: `src/__tests__/session-memory.test.ts`
- Create: `src/__tests__/file-snapshot.test.ts`

### Responsibility split

- `session-store.ts`
  Persists session envelopes, run history, and current memory state under `.opinionate/sessions/<id>/`.

- `session-memory.ts`
  Builds bounded resume context from prior runs: summary, accepted decisions, unresolved issues, and latest recommendation.

- `file-snapshot.ts`
  Captures safe snapshots of relevant text files, computes hashes, and produces deltas between the last snapshot and the current file contents.

- `session-paths.ts`
  Centralizes path resolution so session storage stays predictable and testable.

This separation avoids turning `cli.ts` or `deliberation.ts` into another large coordination file.

---

## Session Contract

### Session envelope

Use a durable JSON envelope similar to:

```ts
interface DeliberationSession {
  version: 1;
  id: string;
  cwd: string;
  mode: DeliberationMode;
  task: string;
  status: 'active' | 'completed' | 'abandoned';
  createdAt: number;
  lastAccessedAt: number;
  updatedAt: number;
  memory: {
    summary: string;
    acceptedDecisions: string[];
    rejectedIdeas: string[];
    openQuestions: string[];
    latestRecommendation?: string;
    latestPeerPosition?: string;
  };
  files: Array<{
    path: string;
    sha256: string;
    sizeBytes: number;
    lastIncludedAt: number;
    snapshotFile?: string;
  }>;
  runs: SessionRun[];
}

interface SessionRun {
  id: string;
  startedAt: number;
  completedAt?: number;
  mode: DeliberationMode;
  task: string;
  rounds: number;
  agreed: boolean;
  partialRounds?: number[];
  summary: string;
}
```

### Storage location

Store sessions under:

```text
.opinionate/sessions/<session-id>/
  session.json
  snapshots/<sha256>.txt
  traces/...
```

Session ids should be human-usable and collision-resistant. Use:

```text
YYYYMMDD-HHmmss-<6-char base36 random suffix>
```

Example:

```text
20260323-151422-k4x9pt
```

### Safety boundary

- Only snapshot files that have already passed opinionate’s ignore filtering.
- Only snapshot text files.
- Skip binary files and files above a conservative cap, for example `200KB`.
- Reuse the same ignore logic as peer context collection so the tool does not save files the user expected to exclude.
- Keep snapshot blobs content-addressed and deduplicated by hash within the session.

Snapshot storage is intentionally retained. Git history is not enough because a reviewed artifact may be uncommitted workspace state, and v2 needs to diff against “last reviewed state”, not just against `HEAD`.

---

## CLI Contract

### Recommended command surface

Keep `run`, add explicit `continue`.

#### New session

```bash
opinionate run \
  --persist-session \
  --mode plan \
  --task "Improve the session model" \
  --files "docs/plans/foo.md,src/core/bar.ts"
```

Behavior:

- remains stateless unless `--persist-session` is passed
- when `--persist-session` is passed, creates a new session
- returns `sessionId` in the JSON result
- writes `.opinionate/sessions/<id>/session.json`

#### Continue a session

```bash
opinionate continue \
  --session <id> \
  --task "I updated the plan to address the duplicate-output concern" \
  --files "docs/plans/foo.md"
```

Behavior:

- loads prior session memory
- computes changed files since last run
- sends a resume payload that includes prior conclusions and current deltas
- appends a new run entry into the same session

### Why `continue` is better than overloading `run`

- clearer for the user
- clearer for the Claude skill
- avoids silent session reuse
- keeps the new stateful behavior explicit without breaking the existing mental model of `run`

### Why `run` should stay stateless by default

Current `run` behavior has no disk side effects beyond optional traces. Auto-creating sessions on every run would be a product behavior change and would leave state behind even for one-off deliberations.

So the recommended contract is:

- `opinionate run` => current stateless behavior
- `opinionate run --persist-session` => creates a resumable session
- `opinionate continue --session <id>` => resumes a stored session

---

## Prompt Strategy for Resume

Do **not** replay the entire historical transcript on every continuation.

Instead, resume payloads should contain:

1. session summary
2. accepted decisions
3. still-open questions
4. previous recommendation
5. what changed since the last run
6. current user guidance
7. current relevant files (inline or reference, using existing file-strategy rules)

### Resume context shape

~~~markdown
## Session Memory
- Session: <id>
- Original task: ...
- Latest recommendation: ...

## Accepted Decisions
- ...

## Open Questions
- ...

## Changes Since Last Review
- docs/plans/foo.md changed
- src/core/bar.ts unchanged

## File Deltas
### docs/plans/foo.md
    @@
    - old line
    + new line
~~~

This gives Codex continuity without exploding the prompt.

---

## Implementation Tasks

### Task 1: Add the session types and persistent store

**Files:**
- Modify: `src/core/types.ts`
- Create: `src/core/session-store.ts`
- Create: `src/util/session-paths.ts`
- Test: `src/__tests__/session-store.test.ts`

- [x] **Step 1: Add additive session types to the public contract**

Add:

- `sessionId?: string` to `DeliberationResult`
- `sessionMemory?: DeliberationSessionMemory` to `DeliberationResult`
- `ResumeOptions` or equivalent internal types for continuation metadata
- `DeliberationSession` and `SessionRun` internal types in `session-store.ts`

Keep backward compatibility: existing consumers that only read `agreed`, `summary`, `decision`, and `transcript` must continue to work unchanged.

- [x] **Step 2: Write failing tests for session path resolution and save/load behavior**

Cover:

- session file path under `.opinionate/sessions/<id>/session.json`
- generated session ids follow the documented `YYYYMMDD-HHmmss-<suffix>` format
- creating a new session envelope
- appending a run entry
- opportunistic cleanup prunes expired completed sessions
- loading a missing session returns a clear error

Run: `pnpm test -- src/__tests__/session-store.test.ts`
Expected: FAIL because session store does not exist yet.

- [x] **Step 3: Implement `session-paths.ts`**

Add helpers:

- `getOpinionateDir(cwd)`
- `getSessionDir(cwd, sessionId)`
- `getSessionFile(cwd, sessionId)`
- `getSessionSnapshotsDir(cwd, sessionId)`

- [x] **Step 4: Implement `session-store.ts`**

Required operations:

- `generateSessionId(...)`
- `createSession(...)`
- `loadSession(...)`
- `saveSession(...)`
- `appendSessionRun(...)`
- `updateSessionMemory(...)`
- `pruneExpiredSessions(...)`

Pruning policy for v2:

- prune `completed` or `abandoned` sessions older than 30 days
- never auto-delete `active` sessions
- run pruning opportunistically on persisted `run --persist-session` and `continue`

- [x] **Step 5: Run tests**

Run: `pnpm test -- src/__tests__/session-store.test.ts`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/session-store.ts src/util/session-paths.ts src/__tests__/session-store.test.ts
git commit -m "feat: add persistent opinionate session store"
```

### Task 2: Snapshot relevant files and compute deltas safely

**Files:**
- Create: `src/util/file-snapshot.ts`
- Modify: `src/core/context-builder.ts`
- Test: `src/__tests__/file-snapshot.test.ts`
- Test: `src/__tests__/context-builder.test.ts`

- [x] **Step 1: Write failing tests for safe snapshot capture and delta generation**

Cover:

- text file snapshot is saved only once per unique hash
- ignored files are rejected
- oversized files are skipped
- unchanged files produce no delta
- changed Markdown file produces a compact diff
- oversized diffs fall back to a compact “changed, read from disk” marker

Run: `pnpm test -- src/__tests__/file-snapshot.test.ts src/__tests__/context-builder.test.ts`
Expected: FAIL because file snapshot support does not exist.

- [x] **Step 2: Implement snapshot helpers**

Expose helpers like:

- `captureFileSnapshot(...)`
- `hashFileContent(...)`
- `buildFileDelta(previous, current)`

Use line-based unified diffs for docs/config/code. Do not attempt AST-level diffs in v2.

Budget rules:

- cap per-file delta text at `8KB`
- cap total rendered delta text at `24KB`
- if a delta exceeds the per-file cap, replace it with:
  - `file changed (delta too large; read from disk)`
- if aggregate deltas exceed the total cap, keep the largest-value deltas first and downgrade the rest to summary markers

- [x] **Step 3: Teach the context builder to render resume deltas**

Add a new section such as:

```markdown
## Changes Since Last Review
...
```

This should be separate from `## Relevant Files` so the peer can distinguish historical memory from current artifact state.

- [x] **Step 4: Run tests**

Run: `pnpm test -- src/__tests__/file-snapshot.test.ts src/__tests__/context-builder.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/util/file-snapshot.ts src/core/context-builder.ts src/__tests__/file-snapshot.test.ts src/__tests__/context-builder.test.ts
git commit -m "feat: add file snapshots and resume deltas"
```

### Task 3: Build bounded session memory for continuation

**Files:**
- Create: `src/core/session-memory.ts`
- Modify: `src/core/deliberation.ts`
- Modify: `src/core/context-builder.ts`
- Modify: `src/core/types.ts`
- Test: `src/__tests__/session-memory.test.ts`
- Test: `src/__tests__/deliberation.test.ts`

- [x] **Step 1: Write failing tests for memory synthesis**

Cover:

- final-round peer response includes a structured session-memory block
- structured memory is parsed into a typed object
- accepted decisions are carried forward
- unresolved questions remain open
- prior recommendations appear in resume memory
- fallback heuristics are used only when structured memory is missing
- raw historical transcript is not fully replayed on resume

Run: `pnpm test -- src/__tests__/session-memory.test.ts src/__tests__/deliberation.test.ts`
Expected: FAIL because no session memory synthesis exists.

- [x] **Step 2: Add a structured final-response contract for session memory**

In the final round, ask the peer to append a machine-readable block such as:

```text
<opinionate-session-memory>
{
  "acceptedDecisions": ["..."],
  "rejectedIdeas": ["..."],
  "openQuestions": ["..."],
  "latestRecommendation": "...",
  "latestPeerPosition": "..."
}
</opinionate-session-memory>
```

`session-memory.ts` should parse this block first. Only if parsing fails should it fall back to limited heuristics using `decision`, `recommendedPath`, `peerPosition`, and `keyDisagreements`.

- [x] **Step 3: Implement session memory synthesis**

Given a prior result and session state, derive a compact memory block:

- `summary`
- `acceptedDecisions`
- `rejectedIdeas`
- `openQuestions`
- `latestRecommendation`
- `latestPeerPosition`

Do not store the full prior transcript as the primary resume mechanism.

- [x] **Step 4: Update the prompt-building path to accept explicit resume memory**

This is the core integration point and should be explicit:

- add `resumeMemory?: DeliberationSessionMemory` to `DeliberationContext`
- add `fileDeltas?: FileDelta[]` to `DeliberationContext`
- `cli.ts` loads the session, computes deltas, and constructs `DeliberationContext`
- `context-builder.ts` renders `## Session Memory` and `## Changes Since Last Review`
- `deliberation.ts` itself remains responsible only for the inner round loop and passes the enriched context through to `ContextBuilder`

- [x] **Step 5: Keep the current inner loop unchanged**

Do not redesign the internal round model. The improvement is at the outer-run layer, not the per-round deliberation engine.

- [x] **Step 6: Run tests**

Run: `pnpm test -- src/__tests__/session-memory.test.ts src/__tests__/deliberation.test.ts`
Expected: PASS

- [x] **Step 7: Commit**

```bash
git add src/core/session-memory.ts src/core/deliberation.ts src/core/context-builder.ts src/core/types.ts src/__tests__/session-memory.test.ts src/__tests__/deliberation.test.ts
git commit -m "feat: add bounded session memory for resumed deliberations"
```

### Task 4: Add `continue` session workflow to the CLI

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/core/runtime-config.ts`
- Modify: `src/index.ts`
- Test: `src/__tests__/cli.test.ts`
- Test: `src/__tests__/runtime-config.test.ts`

- [x] **Step 1: Write failing CLI tests for `continue --session <id>`**

Cover:

- missing `--session` fails with a clear message
- `run` remains stateless without `--persist-session`
- `run --persist-session` creates and returns a session id
- valid session loads prior state
- resumed run emits `sessionId` in JSON output
- invalid session id fails cleanly

Run: `pnpm test -- src/__tests__/cli.test.ts`
Expected: FAIL because `continue` is not supported yet.

- [x] **Step 2: Add `continue` command parsing**

Update usage text and subcommand dispatch.

- [x] **Step 3: Wire session load/save into CLI orchestration**

Behavior:

- `run` remains ephemeral unless `--persist-session` is set
- `run --persist-session` creates a session automatically
- `continue` requires `--session <id>`
- after each successful run, append run metadata and refresh memory/file snapshots

- [x] **Step 4: Add additive JSON fields**

Return:

- `sessionId`
- optional `continuedFromSession: true`
- optional `persistedSession: true`

Keep stdout JSON backward compatible.

- [x] **Step 5: Run CLI tests**

Run: `pnpm test -- src/__tests__/cli.test.ts`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add src/cli.ts src/core/runtime-config.ts src/index.ts src/__tests__/cli.test.ts
git commit -m "feat: add opinionate continue workflow"
```

### Task 5: Update the Claude skill and docs for the outer-loop workflow

**Files:**
- Modify: `skill/opinionate/skill.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-03-22-agent-deliberate-design.md`

- [x] **Step 1: Update the skill contract**

Replace the current “restart with guidance means a brand new run” rule with:

- first pass: `opinionate run`
- after user/Claude edits: `opinionate continue --session <id>`

Make it explicit that the tool is now stateful across runs at the session layer.

- [x] **Step 2: Update README examples**

Add a documented multi-pass flow:

1. draft artifact
2. `opinionate run`
3. revise artifact
4. `opinionate continue`

- [x] **Step 3: Update the design spec**

The current design doc still documents stateless restart behavior. Bring it in line with the new product model.

- [x] **Step 4: Commit**

```bash
git add skill/opinionate/skill.md README.md docs/superpowers/specs/2026-03-22-agent-deliberate-design.md
git commit -m "docs: describe stateful opinionate session workflow"
```

### Task 6: End-to-end verification and rollout guardrails

**Files:**
- Modify: `README.md` (if verification notes are missing)
- Modify: `src/__tests__/cli.test.ts`
- Modify: `src/__tests__/deliberation.test.ts`

- [x] **Step 1: Add an end-to-end fixture test for the real user flow**

Simulate:

1. run a new session on `plan-v1`
2. save session id
3. change the plan file
4. run `continue`
5. assert the continuation payload includes session memory plus file delta, not a full replay of old transcript

- [x] **Step 2: Verify prompt budget behavior**

Ensure resumed runs still respect:

- `--file-strategy auto`
- timeout retry behavior
- context budget constraints

- [x] **Step 3: Run full verification**

Run:

```bash
pnpm build
pnpm test
```

Expected:

- build passes
- CLI tests pass
- new session-store/file-snapshot/session-memory tests pass
- no regression in current DX/resilience tests

- [x] **Step 4: Commit**

```bash
git add src/__tests__/cli.test.ts src/__tests__/deliberation.test.ts README.md
git commit -m "test: verify stateful opinionate sessions end to end"
```

---

## Key Design Rules

### Rule 1: Persist memory, not just transcript

The outer loop should store structured memory:

- what was decided
- what was rejected
- what is unresolved

This is more useful than replaying raw chat history forever.

### Rule 1A: Prefer structured memory blocks over prose parsing

Session continuity should be driven by structured output from the peer whenever possible. Heuristic extraction from free-form text is fallback behavior, not the primary contract.

### Rule 2: Resume from deltas, not from whole files

When the user edits a plan or code, the continuation should emphasize:

- what changed
- why it changed
- how that affects the prior recommendation

That is the core value of a stateful multi-agent workflow.

### Rule 3: Keep Codex subprocesses disposable

Do not try to create a long-lived Codex shell session. Keep peer invocations restartable and observable.

### Rule 4: Default to workspace-local state

Session storage should be local to the project, simple to inspect, and easy to delete.

### Rule 4A: Persist only on explicit opt-in

One-off deliberations should not create session directories unless the caller explicitly requests persistence.

### Rule 5: Preserve backward compatibility

All JSON/API changes must be additive.

---

## Risks And Mitigations

### Risk: session state grows without bound

Mitigation:

- keep only bounded memory plus run summaries in `session.json`
- store snapshots only for included text files
- deduplicate snapshot blobs by content hash
- opportunistically prune completed/abandoned sessions older than 30 days
- avoid replaying full transcript by default

### Risk: sensitive files get persisted locally

Mitigation:

- reuse ignore filtering before snapshotting
- skip binary files and large files
- document storage location clearly

### Risk: resume prompts become confusing

Mitigation:

- separate `Session Memory`, `Changes Since Last Review`, and `Relevant Files` into distinct sections
- keep the continuation `--task` focused on “what changed” rather than restating the whole project

### Risk: CLI complexity expands too far

Mitigation:

- keep v2 to `run` + `continue`
- defer `list-sessions`, `show-session`, and branching/session-merge commands

---

## Non-Goals

- Cross-project session portability
- Remote or synced session stores
- Automatic plan/code rewriting by opinionate
- Replacing Claude as the editor/orchestrator outside the existing loop
- Turning opinionate into a generic agent runtime

---

## Expected Outcome

After this plan ships, the complex-task workflow should feel like this:

1. Claude drafts a plan or code change.
2. `opinionate run --persist-session` creates session `S1`.
3. Codex critiques the artifact.
4. Claude edits the artifact.
5. `opinionate continue --session S1` reviews only the changed artifact plus prior conclusions.
6. The quality of the joint Claude+Codex result compounds over multiple passes instead of resetting every time.

That is the right product shape if opinionate is supposed to help one agent get better results by deliberately leveraging another.
