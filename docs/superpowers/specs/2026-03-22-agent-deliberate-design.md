# opinionate — Design Spec

## Overview

An npm package (`opinionate`) that enables structured peer deliberation within Claude Code. Claude remains the human-facing orchestrator, while a second AI agent (starting with Codex CLI) acts as a sparring partner for planning, reviewing, debugging, and decision-making. In v1, the package drives a deterministic orchestrator/peer exchange rather than two live models talking freely; the resulting recommendation is returned to Claude for final presentation and human approval.

## Goals

- Feel like a natural power-up inside Claude Code, not a separate workflow
- Ship as an npm package with a Claude Code skill + adapter framework
- Codex CLI as the first peer adapter; community adds others (Gemini, local models, etc.)
- Make the v1 loop deterministic and inspectable so the skill has a stable runtime contract
- Human stays in the loop: sees the deliberation transcript, approves the final decision

## Architecture

### Package Structure

```
opinionate/
├── src/
│   ├── core/
│   │   ├── deliberation.ts       # Main deliberation loop engine (owns the loop)
│   │   ├── context-builder.ts    # Assembles context with safety filtering
│   │   ├── agreement-detector.ts # Heuristic convergence + result synthesis
│   │   └── types.ts              # Shared types/interfaces
│   ├── adapters/
│   │   ├── adapter.ts            # Abstract Adapter interface
│   │   └── codex-cli.ts          # Codex CLI implementation (shells out)
│   ├── cli.ts                    # Narrow runtime entrypoint used by Claude Code skill integrations
│   └── index.ts                  # Public API exports (library usage)
├── skill/
│   └── deliberate/
│       ├── skill.md              # Claude Code skill definition
│       └── install.ts            # Copies skill into .agents/
├── package.json                  # bin: { "opinionate": "./dist/cli.js" }
├── tsconfig.json
└── README.md
```

### Core Types

```typescript
interface DeliberationMessage {
  role: 'orchestrator' | 'peer';
  content: string;
  round: number;       // A "round" = one exchange (orchestrator prompt + peer response)
  timestamp: number;
}

interface DeliberationResult {
  agreed: boolean;
  summary: string;
  decision?: string;            // present when agreed === true
  recommendedPath: string;      // package-synthesized best next step
  peerPosition: string;         // peer's final recommendation
  keyDisagreements: string[];   // empty when agreed === true
  transcript: DeliberationMessage[];
  rounds: number;
}

interface DeliberationConfig {
  maxRounds: number;           // default: 5 (each round = 1 orchestrator prompt + 1 peer response)
  timeout: number;             // per-round timeout in ms, default: 60000
  mode: DeliberationMode;
  peerAdapter: Adapter;
  orchestratorAdapter?: Adapter; // when provided, generates prompts via LLM instead of templates
                                 // when absent, uses built-in template engine (v1 default)
  context: DeliberationContext;
  contextBudget: number;       // max context size in bytes, default: 50000
  onRoundComplete?: (round: number, transcript: DeliberationMessage[]) => void;
}

type DeliberationMode = 'plan' | 'review' | 'debug' | 'decide';

interface DeliberationContext {
  task: string;                // What we're deliberating about
  files?: FileContext[];       // Relevant files with path + content
  gitLog?: string;             // Recent git history
  conversationSummary?: string; // Current conversation context
  cwd?: string;                // Working directory
}

interface FileContext {
  path: string;
  content: string;
}

class DeliberationError extends Error {
  constructor(
    message: string,
    public code: 'ADAPTER_UNAVAILABLE' | 'ADAPTER_TIMEOUT' | 'ADAPTER_ERROR' | 'MAX_ROUNDS_EXCEEDED',
    public round?: number
  ) { super(message); }
}
```

### Adapter Interface

```typescript
interface Adapter {
  name: string;
  initialize(): Promise<void>;
  sendMessage(prompt: string, context: DeliberationContext): Promise<string>;
  isAvailable(): Promise<boolean>;
  cleanup(): Promise<void>;
}
```

The Codex CLI adapter:
- `isAvailable()`: checks `codex` is installed via `which codex`
- `initialize()`: validates codex version, no-op for CLI adapter
- `sendMessage()`: shells out to `codex` with the prompt and full budgeted context every round (since each CLI invocation is stateless — see Context Management)
- `cleanup()`: kills any dangling child processes
- Timeout: respects `config.timeout`, kills the subprocess if exceeded

**Adapter role flexibility:** The same `Adapter` interface is used for both `peerAdapter` and `orchestratorAdapter`. This means any adapter (Codex CLI, a future Claude API adapter, Gemini, a local model) can serve either role. For example:
- v1 default: templates as orchestrator, Codex CLI as peer
- Future: Claude API adapter as orchestrator, Codex CLI as peer
- Future: Codex CLI as orchestrator, Claude API adapter as peer
- Future: any two different adapters in either role

Error handling:
- If `isAvailable()` returns false → throws `DeliberationError('ADAPTER_UNAVAILABLE')` with message suggesting install instructions
- If subprocess times out → throws `DeliberationError('ADAPTER_TIMEOUT')`
- If subprocess returns empty/error → throws `DeliberationError('ADAPTER_ERROR')` with stderr content
- The deliberation engine catches these and presents the error to the human with the option to proceed without deliberation

### Loop Ownership

**V1 is structured peer deliberation, not a symmetric two-agent chat.** The package owns the deliberation loop entirely. Claude does not participate mid-loop.

The flow:
1. Claude (via skill) invokes the package with a mode, task description, and context
2. The package runs the full deliberation autonomously:
   - If `orchestratorAdapter` is provided: sends conversation state to it to generate each orchestrator prompt
   - If `orchestratorAdapter` is absent (v1 default): generates orchestrator prompts using built-in templates
   - Sends orchestrator prompts to the `peerAdapter` (Codex)
   - Detects agreement and synthesizes a final recommendation using heuristics within the package
3. The package returns a `DeliberationResult` to Claude
4. Claude presents the result to the human

In v1 (no `orchestratorAdapter`), the `"orchestrator"` messages in the transcript are template-driven prompts. When `orchestratorAdapter` is provided, they are live LLM-generated responses — enabling true two-agent deliberation in a future version. The package is a self-contained engine in both cases.

### Deliberation Loop

1. Package generates opening orchestrator prompt (via `orchestratorAdapter` if provided, otherwise from mode template + context)
2. Prompt is sent to peer agent via `peerAdapter`
3. Peer responds
4. Package generates follow-up orchestrator prompt incorporating peer's response (via `orchestratorAdapter` or template)
5. Agreement detector evaluates the exchange for convergence and updates result synthesis state
6. If agreed → return `DeliberationResult` with `decision`, `recommendedPath`, and `peerPosition` aligned
7. If not agreed and rounds < max → go to step 2
8. If max rounds hit → return result with `agreed: false`, `recommendedPath`, `peerPosition`, and `keyDisagreements`

### Agreement Detection and Result Synthesis

Since the package owns the loop (no mid-loop LLM calls to Claude), agreement detection uses structured heuristics:

1. **Explicit signals**: Check the peer's response for convergence language ("I agree", "let's go with", "sounds good", "that works", "LGTM", "concur", "aligned"). Also check for disagreement signals ("I disagree", "however I think", "instead I'd suggest", "the problem with that").
2. **Proposal stability**: If the peer's response in round N proposes the same approach as round N-1 (measured by key term overlap), treat it as soft agreement.
3. **Scoring**: Agreement signals add +1, disagreement signals add -1, stability adds +0.5. If score >= 1.0 after a round, convergence is declared.
4. **Result synthesis**:
   - On convergence: `decision`, `recommendedPath`, and `peerPosition` are all set from the converged recommendation; `keyDisagreements` is empty.
   - On max rounds: `recommendedPath` is synthesized from the most stable proposal seen across rounds, `peerPosition` is taken from the last peer response, and `keyDisagreements` is populated from unresolved deltas between the stable proposal and the final peer response.
5. **Summary generation**: `summary` is a template-built recap from the final synthesis state, not a separate model call.

This is intentionally simple for v1. If it proves too noisy, a future version can add an LLM-as-judge call using a cheap model.

### Context Management

The `ContextBuilder` handles assembling, budgeting, and safety-filtering context:

**Budgeting:**
- Total context budget is configurable (default: 50KB)
- The budget is split into two reserves:
  - **Static context** (files, git log, conversation summary): 70% of budget on round 1, shrinks as transcript grows
  - **Transcript**: grows from 0% on round 1, capped at 60% of total budget
- When the transcript exceeds its reserve, older rounds are summarized: rounds 1..N-2 are replaced with a one-paragraph summary, keeping only the last 2 full rounds. This preserves the most recent context while staying within budget.
- Files are included with path + content, prioritized by relevance to the task. If files must shrink to make room for transcript, they are truncated with a "[truncated]" marker.
- Git log is trimmed to last 20 commits
- **Every round sends the full budgeted context** — since Codex CLI is stateless (fresh process per invocation), it needs the full picture each time. The transcript is appended to context on rounds 2+.

**Safety filtering (`.opinionateignore`):**
- Before any context is sent to the peer adapter, files are filtered:
  - `.gitignore` patterns are respected (never send ignored files)
  - `.env`, `.env.*`, `*credentials*`, `*secret*`, `*.pem`, `*.key` are excluded by default
  - A `.opinionateignore` file (same syntax as .gitignore) allows users to add custom exclusions
- If a file matches an exclusion pattern, it is silently dropped from context
- The context builder logs which files were included and excluded (visible in verbose mode)

**Limitations of safety filtering:**
- This is **filename-pattern-based only**. It does not scan file contents for embedded secrets, API keys, or tokens. A tracked source file containing a hardcoded key will be forwarded if its name doesn't match an exclusion pattern.
- Users who work with inline secrets should add the relevant paths to `.opinionateignore`.
- A future version may add content scanning (e.g., regex for common key formats), but v1 does not promise this.

### Deliberation Modes

**Plan** — Before implementation. Agents discuss approach, architecture, trade-offs.
Opening prompt: "We need to plan: {task}. Here's the context: {context}. What's your recommended approach?"

**Review** — After code is written. One reviews the other's output.
Opening prompt: "Review this implementation: {context}. What issues do you see? What would you improve?"

**Debug** — When stuck. Agents brainstorm solutions.
Opening prompt: "We're stuck on: {task}. Here's what we know: {context}. What could be causing this?"

**Decide** — Technical decisions. The orchestrator presents the choice; the peer weighs options.
Opening prompt: "We need to decide: {task}. Context: {context}. What's your recommendation and why?"

### Auto-Trigger Behavior

Claude uses its own judgment to decide when a task would benefit from deliberation. No config rules or keyword matching — the agent assesses complexity and stakes naturally. The skill prompt guides this judgment.

### Runtime Invocation Path

The package exposes a CLI entrypoint via `bin` in package.json:

```bash
# v1: template orchestrator + Codex CLI peer (default)
opinionate run \
  --mode plan \
  --task "Design the authentication system" \
  --cwd /path/to/project \
  --files "src/auth.ts,src/middleware.ts" \
  --git-log \
  --conversation-summary "User wants OAuth2 with refresh tokens" \
  --max-rounds 5 \
  --timeout 60000 \
  --context-budget 50000

# future: dual-adapter mode (two live LLMs)
opinionate run \
  --mode plan \
  --task "Design the authentication system" \
  --peer-adapter codex-cli \
  --orchestrator-adapter claude-api \
  ...
```

When `--orchestrator-adapter` is omitted, the built-in template engine is used (v1 behavior). When provided, it names a registered adapter to generate orchestrator prompts.

**Output:** The CLI writes a JSON `DeliberationResult` to stdout. All progress/debug output goes to stderr. This makes it trivially parseable by any calling agent.

The CLI is the **stable runtime surface** that the skill (and any future integration) invokes. It is intentionally narrow: one non-interactive `run` command plus flags. The library exports are for programmatic use by adapter authors and advanced integrations.

### Claude Code Skill Integration

The skill is defined in `skill/opinionate/skill.md` as a standard Claude Code skill:
- **Trigger**: The skill description tells Claude when to invoke it (complex planning, architecture decisions, debugging dead-ends, code review)
- **Manual invoke**: User can type `/opinionate` to force a deliberation
- **Installation**: `npx opinionate install` copies the skill into the project's `.claude/skills/opinionate/SKILL.md` path
- **How it works**: The skill prompt instructs Claude to run `opinionate run` via Bash, passing the task, mode, relevant file paths, and conversation summary as CLI flags. Claude parses the JSON result from stdout and presents it to the human using the terminal output contract below.

### Human Interaction — Terminal Output Contract

All output is plain text/markdown rendered in the terminal. No UI widgets or expandable elements.

**On convergence (agreed: true):**
```
## Deliberation Complete (3 rounds, agreed)

### Decision
{decision text}

### Summary
{summary of the deliberation}

### Full Transcript
**Round 1 — Orchestrator Prompt:**
{orchestrator prompt}

**Round 1 — Peer (Codex):**
{peer response}

**Round 2 — Orchestrator Prompt:**
...

Approve this decision? [y/n/restart with guidance]
```

**On max rounds (agreed: false):**
```
## Deliberation Inconclusive (5 rounds, no agreement)

### Recommended Path
{recommendedPath}

### Peer Position
{peerPosition}

### Key Disagreements
- {disagreement 1}
- {disagreement 2}

### Full Transcript
...

How would you like to proceed? [accept recommendation / accept peer / restart with guidance]
```

**"Restart with guidance"** means Claude starts a completely new `opinionate run` invocation, prepending the user's guidance to the task description. There is no session resume or transcript seeding in v1 — each deliberation is stateless. This keeps the implementation simple and avoids the complexity of partial-transcript replay.

**Progress during deliberation (via `onRoundComplete`):**
```
Deliberating... Round 2/5 complete.
```

## Non-Goals (v1)

- A user-facing interactive CLI experience beyond the narrow `opinionate run` integration command
- Symmetric two-live-agent free-form conversation in v1
- Formal protocol specification (extract later if adoption warrants it)
- More than one adapter (Codex CLI only, but interface is ready for more)
- Web UI or dashboard
- Persistent deliberation history
- Streaming responses from adapters

## Success Criteria

- A developer can `npm install opinionate`, run the install script, and have Claude invoke a Codex-backed structured deliberation run on their next planning task
- The deliberation produces better outcomes than single-agent planning
- Adding a new adapter requires implementing one interface (`Adapter` with 4 methods + name property)
- Adapter failures are handled gracefully with clear error messages
- Files matching known sensitive patterns (.env, *.key, etc.) are excluded from peer context by default. Users are responsible for adding additional exclusions via `.opinionateignore` for project-specific secrets.
