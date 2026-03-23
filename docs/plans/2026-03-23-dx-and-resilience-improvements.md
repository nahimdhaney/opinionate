# Opinionate DX and Resilience Improvements

**Date:** 2026-03-23
**Status:** Implemented
**Motivation:** Real-world usage session where 3 consecutive deliberation attempts failed or timed out before a 4th succeeded, wasting ~35 minutes of wall time. The problems exposed fundamental gaps in visibility, timeout resilience, peer configuration, and prompt sizing.

---

## Session Failure Log (What Actually Happened)

This plan is grounded in a specific debugging session. Here is the exact sequence of events:

| Attempt | Timeout | `--files` | Result | Root Cause |
|---------|---------|-----------|--------|------------|
| 1 | 120s | Yes (320-line plan inlined) | SIGTERM at 120s | Prompt too large for gpt-5.4 + xhigh reasoning |
| 2 | 180s | Yes (same) | SIGTERM at 180s | Same — more time did not help |
| 3 | 600s | Yes (same) | SIGTERM at 600s | gpt-5.4 + xhigh spent all 10min in reasoning, never emitted output |
| 4 | 600s | No (peer reads from disk) | Success in ~5min, 2 rounds | Smaller prompt let Codex finish; it read the file itself |

**Contributing factors discovered during investigation:**

1. **Codex had a failing MCP server** (`lifi`) that added 10s startup overhead per invocation and emitted errors to stderr — opinionate never surfaced this
2. **Codex config had `model_reasoning_effort = "xhigh"`** — opinionate has no way to override this, so every invocation used maximum reasoning
3. **Zero feedback during execution** — all 4 attempts showed identical output (`[opinionate] Round 1: starting Codex peer`) and then silence for 2-10 minutes until SIGTERM
4. **Partial output was discarded** — even if Codex had produced tokens before timeout, they were thrown away
5. **No diagnostic help** — user had to manually run `codex exec "Say hello"` to diagnose the MCP and reasoning-effort issues

---

## Improvement Areas

### Area 1: Live Visibility During Execution

**Problem:** After `[opinionate] Round 1: starting Codex peer`, there is complete silence until the round finishes or times out. For slow models (gpt-5.4 + xhigh), this can be 10+ minutes of nothing.

**Current code:** `codex-cli.ts:162-172` — stdout/stderr chunks are accumulated in string variables and forwarded to `ExecutionTrace` hooks. The trace hooks in `execution-trace.ts:126-139` only emit to stderr if `--show-peer-output` is explicitly set.

**Why `--show-peer-output` alone isn't sufficient:** The user must know to pass it. Even `--verbose` doesn't enable it. And the raw Codex output is noisy — the user needs curated signals, not a firehose.

#### Task 1A: Add elapsed-time heartbeat during peer execution

**Files:**
- Modify: `src/adapters/codex-cli.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/execution-trace.ts`

**What to do:**

Add a periodic heartbeat timer inside `sendMessage()` that emits a status line every 15 seconds when verbose tracing is enabled. The adapter should report through the trace/verbose callback contract rather than reaching into ad hoc `options.verbose` state. The heartbeat should show:
- Elapsed time
- Whether any stdout has been received yet
- Byte count of accumulated stdout/stderr

Example output:
```
[opinionate] Round 1: waiting... 15s elapsed, no output yet
[opinionate] Round 1: waiting... 30s elapsed, no output yet
[opinionate] Round 1: waiting... 45s elapsed, 0 stdout / 1.2KB stderr
[opinionate] Round 1: waiting... 60s elapsed, 0 stdout / 1.2KB stderr
```

**Implementation detail:**

In `sendMessage()`, after spawning the child process (~line 121), start an interval timer:

```typescript
const heartbeat = this.trace && options.verbose ? setInterval(() => {
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  const stdoutSize = Buffer.byteLength(stdout, 'utf-8');
  const stderrSize = Buffer.byteLength(stderr, 'utf-8');
  const outputStatus = stdoutSize > 0
    ? `${(stdoutSize / 1024).toFixed(1)}KB stdout`
    : 'no output yet';
  this.trace?.emitVerbose?.(
    `Round ${round}: waiting... ${elapsed}s elapsed, ${outputStatus} / ${(stderrSize / 1024).toFixed(1)}KB stderr`
  );
}, 15_000) : null;
```

Clear the interval in the `close` handler, the timeout handler, and the `error` handler (every path that exits the promise).

**Why this matters:** This alone would have saved ~20 minutes of confusion in our session. "No output yet after 120s" immediately tells the user the peer is stuck in reasoning, not making progress.

#### Task 1B: Surface Codex lifecycle events from stderr in verbose mode

**Files:**
- Modify: `src/core/execution-trace.ts`

**What to do:**

When `--verbose` is set (not just `--show-peer-output`), parse Codex stderr chunks for high-signal lifecycle events and emit them as curated log lines. Codex stderr contains structured events like:

```
mcp: lifi starting
mcp: lifi failed: ...
mcp startup: no servers
codex
Using `using-superpowers` first...
exec
/bin/zsh -lc "sed -n ..." succeeded in 0ms
```

Add a function `extractLifecycleEvents(chunk: string): string[]` that matches these patterns:

| Pattern | Emit as |
|---------|---------|
| `mcp: <name> failed` | `[opinionate] Round N: peer MCP server '<name>' failed` |
| `mcp: <name> starting` | `[opinionate] Round N: peer MCP server '<name>' starting...` |
| `mcp startup: no servers` | (suppress — not interesting) |
| `exec\n.*succeeded` | `[opinionate] Round N: peer executed tool` |
| `codex\n` followed by text | `[opinionate] Round N: peer is responding...` |

In `onPeerStderr()` (~line 134), when `verbose` is true, pass the chunk through `extractLifecycleEvents()` and emit any matched events. This is separate from `--show-peer-output` which dumps everything raw.

**Why this matters:** We would have immediately seen `peer MCP server 'lifi' failed` instead of discovering it 30 minutes later by manually running `codex exec`.

#### Task 1C: Log prompt size in verbose mode

**Files:**
- Modify: `src/core/deliberation.ts`

**What to do:**

After `buildPromptPayload()` returns the payload string (~line 88), emit the payload size:

```typescript
const payloadSize = Buffer.byteLength(payload, 'utf-8');
this.config.onVerbose?.(`Round ${round}: prompt payload size: ${(payloadSize / 1024).toFixed(1)}KB (budget: ${(this.config.contextBudget / 1024).toFixed(0)}KB)`);
```

Add `onVerbose` as an optional callback in `DeliberationConfig` (in `types.ts`), wired up in `cli.ts` to write to stderr when `--verbose` is set.

**Why this matters:** Seeing `prompt payload size: 48.2KB (budget: 50KB)` immediately explains why the peer is slow.

---

### Area 2: Timeout Resilience

**Problem:** When Codex times out, ALL accumulated output is discarded. The `SIGTERM` at `codex-cli.ts:142` kills the process, and `fail()` at line 154 throws a `DeliberationError` that propagates up and terminates the entire deliberation.

#### Task 2A: Preserve partial output on timeout

**Files:**
- Modify: `src/adapters/codex-cli.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/deliberation.ts`

**What to do:**

**Step 1: Change the adapter timeout flow to preserve partial results without racing process shutdown.**

In `codex-cli.ts`, modify the timeout handler (~line 141). Instead of calling `fail()`, resolve with a partial marker:

```typescript
// In types.ts, add:
export interface AdapterResponse {
  content: string;
  partial: boolean;
  signal?: NodeJS.Signals | null;
  durationMs: number;
}
```

Update the `Adapter` interface's `sendMessage` return type from `Promise<string>` to `Promise<string | AdapterResponse>`. For backward compatibility, string returns are treated as complete responses.

In the timeout handler, do not immediately resolve or reject. Instead:

1. mark the round as timed out
2. send `SIGINT`
3. start a short force-kill timer
4. wait for the process `close` event
5. only then decide whether to surface a partial response or a hard timeout

In pseudocode:

```typescript
const timer = setTimeout(() => {
  timedOut = true;
  // Graceful shutdown: SIGINT first, then SIGTERM after 5s
  child.kill('SIGINT');
  forceTimer = setTimeout(() => {
    child.kill('SIGTERM');
  }, 5_000);
}, this.timeout);

child.on('close', () => {
  clearTimeout(forceTimer);
  const trimmed = stdout.trim();
  if (timedOut && trimmed.length > 0) {
    fail(new DeliberationError(
      `Codex CLI timed out after ${timeoutMs}ms`,
      'ADAPTER_TIMEOUT',
      round,
      { content: trimmed, partial: true },
    ));
    return;
  }
  if (timedOut) {
    fail(new DeliberationError(`Codex CLI timed out after ${timeoutMs}ms`, 'ADAPTER_TIMEOUT', round));
    return;
  }
  resolve(trimmed);
});
```

**Step 2: Handle partial responses in the deliberation loop.**

In `deliberation.ts`, after receiving `peerResponse` (~line 94), check if it's partial:

```typescript
const raw = await peerAdapter.sendMessage(payload, context);
const isPartial = typeof raw === 'object' && raw.partial;
const peerResponse = typeof raw === 'string' ? raw : raw.content;

if (isPartial) {
  // Log that we got a partial response
  this.config.onVerbose?.(`Round ${round}: peer timed out but returned partial response (${peerResponse.length} chars)`);
}
```

The agreement detector and synthesis should still work on partial content — they already handle arbitrary-length peer responses.

**Step 3: Mark partial rounds in the result.**

Add `partialRounds?: number[]` to `DeliberationResult` so the consumer knows which rounds were degraded.

**Why this matters:** In attempt 3 (10 minutes), Codex may have produced a substantial response before being killed. Discarding 9 minutes of work because the last minute timed out is wasteful.

#### Task 2B: Graceful shutdown with SIGINT before SIGTERM

**Files:**
- Modify: `src/adapters/codex-cli.ts`

This is part of Task 2A's implementation but deserves its own callout. Currently `codex-cli.ts:142` sends `SIGTERM` immediately. Codex may be in the middle of writing output. Send `SIGINT` first to give it 5 seconds to flush its buffer, then `SIGTERM` as a fallback.

The cleanup method (`codex-cli.ts:242-247`) should follow the same pattern.

---

### Area 3: Peer Reasoning Effort Control

**Problem:** The user's Codex config had `model_reasoning_effort = "xhigh"` which opinionate inherited silently. There is no CLI flag to override this. For deliberation, `xhigh` is almost never appropriate — the peer needs to be responsive, not exhaustive.

#### Task 3A: Add `--reasoning-effort` CLI flag

**Files:**
- Modify: `src/core/runtime-config.ts`
- Modify: `src/cli.ts`
- Modify: `src/util/codex-cli-info.ts`
- Modify: `src/adapters/codex-cli.ts`

**Step 1: Add to RuntimeConfig.**

In `runtime-config.ts`, add:

```typescript
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export interface RuntimeConfig {
  // ... existing fields
  reasoningEffort?: ReasoningEffort;
}
```

Resolution order:
1. `--reasoning-effort <value>` CLI flag (highest priority)
2. `OPINIONATE_REASONING_EFFORT` env var
3. Not set (inherit Codex's own config)

**Step 2: Pass through to Codex.**

In `codex-cli-info.ts`, modify `buildCodexExecArgs()` to accept a `reasoningEffort` parameter:

```typescript
export function buildCodexExecArgs(
  prompt: string,
  info: Pick<CodexCliInfo, 'supportsExec' | 'supportsModelFlag' | 'supportsConfigFlag'>,
  model?: string,
  reasoningEffort?: string,
): string[] {
  // ... existing code
  if (reasoningEffort && info.supportsConfigFlag) {
    args.push('-c', `model_reasoning_effort="${reasoningEffort}"`);
  }
  args.push(prompt);
  return args;
}
```

**Step 3: Wire through adapter.**

Add `reasoningEffort` to `CodexCliOptions`, pass it from `cli.ts` through `AdapterFactoryOptions` into the adapter, and into `buildCodexExecArgs()`.

**Step 4: Update help text.**

In `cli.ts`, add to `printUsage()`:

```
  --reasoning-effort <low|medium|high>  Override peer reasoning effort (default: inherit from Codex config)
```

**Step 5: Add to `doctor` output.**

In `preflight.ts`, probe the Codex config for `model_reasoning_effort` and display it. If it's `xhigh`, emit a warning:

```
  ⚠ Codex reasoning effort: xhigh (may cause timeouts — consider --reasoning-effort medium)
```

**Why this matters:** This was the #1 root cause of all our timeouts. The user had no idea opinionate was inheriting `xhigh` from their Codex config, and no way to override it short of editing `~/.codex/config.toml`.

---

### Area 4: Smarter File Handling

**Problem:** The `--files` flag reads file content and inlines it into the prompt payload, which becomes a CLI argument to `codex exec`. A 320-line plan file consumed ~45KB of the 50KB budget, creating an enormous prompt that slow models choke on. The successful attempt (attempt 4) simply removed `--files` and let Codex read the file from disk itself.

#### Task 4A: Add `--file-strategy` flag with `inline` (default) and `reference` modes

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/core/context-builder.ts`
- Modify: `src/core/types.ts`

**What to do:**

Add a `--file-strategy` CLI flag with two modes, and make the CLI capable of carrying path-only file references:

- **`inline`** (current default): Read file content and embed it in the prompt payload. This is what happens today.
- **`reference`**: Only include file paths in the prompt, not content. The peer agent reads files from disk using its own tools. Add an instruction to the prompt:

  ```
  ## Relevant Files (read from disk)
  The following files are relevant. Read them before responding:
  - path/to/file1.rs
  - path/to/file2.rs
  ```

In `cli.ts`, avoid eagerly reading large/doc-like files when the strategy resolves to `reference` or `auto->reference`. In `context-builder.ts`, render path-only entries without assuming `FileContext.content` is always present:

```typescript
private fitFilesToBudget(
  files: FileContext[],
  budget: number,
  strategy: 'inline' | 'reference' = 'inline',
): string | null {
  if (strategy === 'reference') {
    const header = '## Relevant Files (read from disk)\nThe following files are relevant. Read them before responding:\n';
    const paths = files.map(f => `- ${f.path}`).join('\n');
    return header + paths;
  }
  // ... existing inline logic
}
```

Add `fileStrategy` to `DeliberationContext` and wire it through from CLI args.

**Why this matters:** This is the exact fix that worked in our session. Reference mode produces a ~200 byte file section instead of ~45KB, and the peer reads files with full context (line numbers, ability to read selectively).

#### Task 4B: Auto-fallback from inline to reference on large files

**Files:**
- Modify: `src/core/context-builder.ts`

**What to do:**

Add an `auto` file strategy (make it the new default) that uses `inline` for small files and `reference` for large ones:

```typescript
if (strategy === 'auto') {
  const totalFileSize = files.reduce(
    (sum, f) => sum + Buffer.byteLength(f.content, 'utf-8'), 0
  );
  // If files would consume >60% of the budget, switch to reference mode
  if (totalFileSize > budget * 0.6) {
    return this.fitFilesToBudget(files, budget, 'reference');
  }
  return this.fitFilesToBudget(files, budget, 'inline');
}
```

This way, small config files and type definitions get inlined (fast), but large plan documents automatically switch to reference mode.

**Why this matters:** The user shouldn't need to know about file strategies. The tool should automatically do the right thing based on file size.

---

### Area 5: MCP Failure Detection

**Problem:** Codex had a failing MCP server (`lifi`) that added 10s startup overhead and emitted errors to stderr. Opinionate never surfaced this. The user only discovered it by manually running `codex exec "Say hello"`.

#### Task 5A: Detect and surface MCP failures from peer stderr

**Files:**
- Modify: `src/core/execution-trace.ts`
- New: `src/util/peer-stderr-parser.ts`

**What to do:**

Create a utility that parses Codex stderr lines for known diagnostic patterns:

```typescript
// src/util/peer-stderr-parser.ts

export interface PeerDiagnostic {
  type: 'mcp-failure' | 'mcp-timeout' | 'model-info' | 'tool-execution';
  severity: 'warning' | 'info';
  message: string;
}

const PATTERNS: Array<{
  regex: RegExp;
  build: (match: RegExpMatchArray) => PeerDiagnostic;
}> = [
  {
    regex: /mcp: (\S+) failed: (.+)/,
    build: (m) => ({
      type: 'mcp-failure',
      severity: 'warning',
      message: `Peer MCP server '${m[1]}' failed: ${m[2]}`,
    }),
  },
  {
    regex: /mcp: (\S+) starting/,
    build: (m) => ({
      type: 'mcp-timeout',
      severity: 'info',
      message: `Peer MCP server '${m[1]}' starting...`,
    }),
  },
  {
    regex: /model: (.+)/,
    build: (m) => ({
      type: 'model-info',
      severity: 'info',
      message: `Peer model: ${m[1]}`,
    }),
  },
  {
    regex: /reasoning effort: (.+)/,
    build: (m) => ({
      type: 'model-info',
      severity: m[1] === 'xhigh' ? 'warning' : 'info',
      message: `Peer reasoning effort: ${m[1]}${m[1] === 'xhigh' ? ' (may cause slow responses)' : ''}`,
    }),
  },
];

export function parsePeerStderr(chunk: string): PeerDiagnostic[] {
  const diagnostics: PeerDiagnostic[] = [];
  for (const line of chunk.split(/\r?\n/)) {
    for (const { regex, build } of PATTERNS) {
      const match = line.match(regex);
      if (match) {
        diagnostics.push(build(match));
        break;
      }
    }
  }
  return diagnostics;
}
```

Wire this into `execution-trace.ts`'s `onPeerStderr()` hook. When `verbose` is true, emit diagnostics with appropriate prefixes:

```
[opinionate] Round 1: Peer MCP server 'lifi' failed: MCP startup failed...
[opinionate] Round 1: Peer reasoning effort: xhigh (may cause slow responses)
```

#### Task 5B: Add MCP health check to `doctor` command

**Files:**
- Modify: `src/core/preflight.ts`
- Modify: `src/util/codex-cli-info.ts`

**What to do:**

The `doctor` command already runs `probeCodexAuth()` which does a quick `codex exec "Return the word ok"`. That lower-level probe must preserve stderr even on successful exec runs, then `preflight.ts` can parse it for MCP failures using the same `parsePeerStderr()` utility.

If MCP failures are detected, add a warning line:

```
  ⚠ MCP servers: 'lifi' failed to start (check your Codex MCP configuration)
```

**Why this matters:** `opinionate doctor` should catch environment issues before the user wastes time on failed deliberations.

---

### Area 6: Retry with Reduced Context

**Problem:** Each failed attempt started completely fresh. After timeout, the user had to manually re-run with different flags. There was no automatic recovery strategy.

#### Task 6A: Add `--retry-on-timeout` flag with automatic context reduction

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/core/deliberation.ts`

**What to do:**

Add a `--retry-on-timeout` flag (default: `false` for backward compatibility). When enabled, if a round times out:

1. Log the timeout: `[opinionate] Round 1: timed out after 600s. Retrying with reduced context...`
2. Switch `fileStrategy` from `inline` to `reference` for the retry
3. Increase the timeout by 50% for the retry by passing a per-call timeout override (or by recreating the adapter with the larger timeout)
4. Retry the same round (don't count it as a completed round)
5. Maximum 1 retry per round (to avoid infinite loops)

**Implementation in deliberation.ts:**

```typescript
// In the round loop, wrap the peer call:
let peerResponse: string;
let retried = false;
try {
    peerResponse = await peerAdapter.sendMessage(payload, context, { timeoutMs: timeout });
} catch (err) {
  if (
    err instanceof DeliberationError &&
    err.code === 'ADAPTER_TIMEOUT' &&
    this.config.retryOnTimeout &&
    !retried
  ) {
    retried = true;
    this.config.onVerbose?.(`Round ${round}: timed out. Retrying with reference-only file context...`);
    // Rebuild payload with reference strategy
    const reducedContext = { ...context, fileStrategy: 'reference' as const };
    const retryPayload = this.contextBuilder.buildPromptPayload(
      orchestratorPrompt, reducedContext, this.transcript, round
    );
    peerResponse = await peerAdapter.sendMessage(retryPayload, reducedContext, {
      timeoutMs: Math.round(timeout * 1.5),
    });
  } else {
    throw err;
  }
}
```

**Why this matters:** This automates the exact recovery strategy that worked in our session (removing inline files). The user doesn't need to know why it's slow — the tool self-heals.

---

### Area 7: Agreement Detection Robustness

**Problem:** The agreement detector uses keyword heuristics (score-based) that can false-positive on phrases like "I agree that X is a problem, but I'd take a different approach" (contains both "i agree" and "alternative approach"). This is a known limitation documented in `agreement-detector.ts:70-87` where agreement and disagreement signals cancel each other.

#### Task 7A: Improve agreement detection prompt for convergence rounds

**Files:**
- Modify: `src/core/deliberation.ts`

**What to do:**

In the follow-up prompt template for the final round (or after round 3), append a structured response request:

```typescript
// In buildRefinement(), for the final round:
return `This is our final round. Let us settle on the best path forward given everything discussed.

Please structure your final response as:
**Verdict:** AGREE or DISAGREE
**Decision:** [one-sentence summary of the agreed approach]
**Details:** [your full response]`;
```

Then in `agreement-detector.ts`, add a fast-path check before the heuristic scoring:

```typescript
// Check for structured verdict first
const verdictMatch = content.match(/\*\*verdict:\*\*\s*(agree|disagree)/i);
if (verdictMatch) {
  if (verdictMatch[1]!.toLowerCase() === 'agree') {
    roundScore += 2; // Strong agreement signal
  } else {
    roundScore -= 2; // Strong disagreement signal
  }
}
```

This makes agreement detection deterministic for well-structured responses while keeping the heuristic as a fallback for free-form responses.

**Why this matters:** Reduces false positives/negatives in agreement detection and makes the deliberation converge faster.

---

## Implementation Order

Tasks are ordered by impact-to-effort ratio, based on what would have helped most in the real session:

| Priority | Task | Area | Impact | Effort | What it would have saved |
|----------|------|------|--------|--------|--------------------------|
| 1 | 3A | Reasoning effort control | Critical | Low | All 4 timeouts (root cause) |
| 2 | 1A | Elapsed-time heartbeat | High | Low | 20min of "is it dead?" confusion |
| 3 | 4A | File strategy reference mode | High | Medium | Attempts 1-3 (auto-smaller prompt) |
| 4 | 1B | Codex lifecycle events | High | Medium | MCP failure discovery |
| 5 | 4B | Auto file strategy | Medium | Low | Makes 4A seamless |
| 6 | 2A | Partial output preservation | Medium | Medium | 10min of lost work in attempt 3 |
| 7 | 5A | MCP failure detection | Medium | Low | Earlier diagnosis |
| 8 | 1C | Prompt size logging | Medium | Low | Immediate size awareness |
| 9 | 5B | Doctor MCP health check | Medium | Low | Pre-flight issue detection |
| 10 | 6A | Retry with reduced context | Medium | Medium | Automatic recovery |
| 11 | 2B | Graceful SIGINT shutdown | Low | Low | Part of 2A |
| 12 | 7A | Agreement detection improvement | Low | Low | Marginal convergence improvement |

---

## Testing Strategy

Each task should include:

1. **Unit tests** in `src/__tests__/` following existing patterns (vitest)
2. **For Task 1A/1B:** Mock the spawn process to emit chunks over time, verify heartbeat and lifecycle events are emitted
3. **For Task 2A:** Mock a process that accumulates stdout then receives SIGTERM, verify partial output is returned
4. **For Task 3A:** Verify `buildCodexExecArgs()` includes `-c model_reasoning_effort="medium"` when set
5. **For Task 4A/4B:** Verify `fitFilesToBudget()` produces reference-only output when strategy is `reference` or when files exceed threshold
6. **For Task 5A:** Unit test `parsePeerStderr()` with real Codex stderr samples
7. **For Task 7A:** Add transcript fixtures that contain "I agree that X is bad, but..." and verify the detector doesn't false-positive

---

## Non-Goals

- **Adding new adapter types** (e.g., Claude adapter) — out of scope for this plan
- **Changing the deliberation protocol** — the orchestrator/peer round structure is fine
- **Changing the JSON output format** — backward compatibility must be maintained (only additive changes like `partialRounds`)
- **Persisting state across deliberations** — each run is stateless by design
