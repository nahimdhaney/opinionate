# opinionate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build v1 `opinionate` as a TypeScript npm package that gives Claude Code a narrow `opinionate run` command for structured Codex-backed peer deliberation.

**Architecture:** Keep the package single-purpose and single-package. `src/core` owns types, prompt templates, context building, agreement heuristics, and the orchestration loop; `src/adapters/codex-cli.ts` shells out to Codex; `src/cli.ts` is the only runtime entrypoint the skill calls. The Claude Code skill stays thin: gather context, call the CLI, parse JSON, render terminal markdown.

**Tech Stack:** Node.js 20+, TypeScript, Vitest, `node:util.parseArgs`, `node:fs/promises`, `node:child_process`.

---

## File Structure

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `README.md`
- Create: `src/index.ts`
- Create: `src/cli.ts`
- Create: `src/core/types.ts`
- Create: `src/core/prompt-templates.ts`
- Create: `src/core/context-builder.ts`
- Create: `src/core/agreement-detector.ts`
- Create: `src/core/deliberation.ts`
- Create: `src/adapters/adapter.ts`
- Create: `src/adapters/codex-cli.ts`
- Create: `skill/opinionate/skill.md`
- Create: `skill/opinionate/install.ts`
- Create: `tests/cli/cli.test.ts`
- Create: `tests/core/prompt-templates.test.ts`
- Create: `tests/core/context-builder.filtering.test.ts`
- Create: `tests/core/context-builder.budget.test.ts`
- Create: `tests/core/agreement-detector.test.ts`
- Create: `tests/core/deliberation.test.ts`
- Create: `tests/adapters/codex-cli.test.ts`
- Create: `tests/skill/install.test.ts`
- Create: `tests/helpers/memory-io.ts`
- Create: `tests/helpers/fake-process.ts`
- Create: `tests/fixtures/context/project/.opinionateignore`
- Create: `tests/fixtures/context/project/.env`
- Create: `tests/fixtures/context/project/src/safe.ts`
- Create: `tests/fixtures/context/project/src/inline-secret.ts`

## Implementation Notes

- Use one narrow CLI command: `opinionate run`.
- Keep stdout machine-parseable JSON only. All progress and diagnostics go to stderr.
- Do not pretend v1 is a symmetric two-model conversation. Use `orchestrator` terminology in code and docs.
- Treat `.opinionateignore` and default sensitive-path filters as best-effort path filtering only. Do not over-promise content scanning.
- Prefer dependency-light implementations. Only add a third-party package when it materially simplifies testing or cross-platform subprocess handling.

### Task 1: Bootstrap the Package and CLI Contract

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/cli.ts`
- Create: `src/index.ts`
- Create: `tests/cli/cli.test.ts`
- Create: `tests/helpers/memory-io.ts`

- [ ] **Step 1: Write the failing CLI contract test**

```ts
it('prints DeliberationResult JSON to stdout and nothing else', async () => {
  const io = createMemoryIO();

  await runCli(
    ['run', '--mode', 'plan', '--task', 'Design auth', '--cwd', '/tmp/project'],
    {
      io,
      runDeliberation: async () => ({
        agreed: true,
        summary: 'Both sides converged on OAuth2.',
        decision: 'Use OAuth2 with refresh tokens',
        recommendedPath: 'Use OAuth2 with refresh tokens',
        peerPosition: 'Use OAuth2 with refresh tokens',
        keyDisagreements: [],
        transcript: [],
        rounds: 1,
      }),
    },
  );

  expect(JSON.parse(io.stdout())).toMatchObject({
    agreed: true,
    decision: 'Use OAuth2 with refresh tokens',
  });
  expect(io.stderr()).toBe('');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/cli/cli.test.ts`
Expected: FAIL with `runCli is not defined` or missing package/test setup errors

- [ ] **Step 3: Create minimal package scaffolding and CLI entrypoint**

```ts
export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const args = parseRunArgs(argv);
  const result = await deps.runDeliberation(args);
  deps.io.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/cli/cli.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/cli.ts src/index.ts tests/cli/cli.test.ts tests/helpers/memory-io.ts
git commit -m "feat: bootstrap package and cli contract"
```

### Task 2: Define Public Types and Prompt Template Builders

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/prompt-templates.ts`
- Modify: `src/index.ts`
- Modify: `src/cli.ts`
- Create: `tests/core/prompt-templates.test.ts`

- [ ] **Step 1: Write the failing prompt-template tests**

```ts
it('builds a plan opening prompt with task and context summary', () => {
  const prompt = buildOpeningPrompt('plan', {
    task: 'Design auth',
    conversationSummary: 'OAuth2 with refresh tokens',
  });

  expect(prompt).toContain('We need to plan: Design auth');
  expect(prompt).toContain('OAuth2 with refresh tokens');
});

it('builds a follow-up prompt from the last peer response', () => {
  const prompt = buildFollowUpPrompt('review', 'I prefer splitting the adapter.');
  expect(prompt).toContain('peer response');
  expect(prompt).toContain('I prefer splitting the adapter.');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/core/prompt-templates.test.ts`
Expected: FAIL with missing exports

- [ ] **Step 3: Implement `DeliberationMessage`, `DeliberationResult`, config types, and prompt builders**

```ts
export interface DeliberationResult {
  agreed: boolean;
  summary: string;
  decision?: string;
  recommendedPath: string;
  peerPosition: string;
  keyDisagreements: string[];
  transcript: DeliberationMessage[];
  rounds: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/core/prompt-templates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/core/prompt-templates.ts src/index.ts src/cli.ts tests/core/prompt-templates.test.ts
git commit -m "feat: define deliberation types and prompt templates"
```

### Task 3: Implement Context Filtering and Ignore Rules

**Files:**
- Create: `src/core/context-builder.ts`
- Create: `tests/core/context-builder.filtering.test.ts`
- Create: `tests/fixtures/context/project/.opinionateignore`
- Create: `tests/fixtures/context/project/.env`
- Create: `tests/fixtures/context/project/src/safe.ts`
- Create: `tests/fixtures/context/project/src/inline-secret.ts`

- [ ] **Step 1: Write the failing filtering test**

```ts
it('drops ignored and sensitive-path files before building context', async () => {
  const result = await buildContext({
    cwd: fixtureProject,
    task: 'Review auth',
    files: [
      `${fixtureProject}/src/safe.ts`,
      `${fixtureProject}/src/inline-secret.ts`,
      `${fixtureProject}/.env`,
    ],
  });

  expect(result.files?.map((file) => file.path)).toEqual(['src/safe.ts']);
  expect(result.excludedFiles).toEqual(
    expect.arrayContaining(['.env', 'src/inline-secret.ts']),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/core/context-builder.filtering.test.ts`
Expected: FAIL with `buildContext is not defined`

- [ ] **Step 3: Implement path filtering, `.gitignore` support, and `.opinionateignore` support**

```ts
const DEFAULT_DENYLIST = ['.env', '.env.*', '*credentials*', '*secret*', '*.pem', '*.key'];

export async function buildContext(input: BuildContextInput): Promise<BuiltContext> {
  const ignore = await loadIgnoreRules(input.cwd);
  const included = [];
  const excluded = [];

  for (const filePath of input.files ?? []) {
    if (matchesSensitivePattern(filePath) || ignore.ignores(relative(input.cwd, filePath))) {
      excluded.push(relative(input.cwd, filePath));
      continue;
    }
    included.push(await readFileContext(input.cwd, filePath));
  }

  return { ...input, files: included, excludedFiles: excluded };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/core/context-builder.filtering.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/context-builder.ts tests/core/context-builder.filtering.test.ts tests/fixtures/context/project/.opinionateignore tests/fixtures/context/project/.env tests/fixtures/context/project/src/safe.ts tests/fixtures/context/project/src/inline-secret.ts
git commit -m "feat: add context filtering and ignore rules"
```

### Task 4: Implement Context Budgeting and Transcript Summarization

**Files:**
- Modify: `src/core/context-builder.ts`
- Create: `tests/core/context-builder.budget.test.ts`

- [ ] **Step 1: Write the failing budget test**

```ts
it('summarizes old rounds when transcript reserve is exceeded', async () => {
  const built = await applyContextBudget({
    contextBudget: 500,
    transcript: makeTranscriptWithFiveRounds(),
    files: [makeLargeFileContext()],
  });

  expect(built.transcriptSummary).toContain('Rounds 1-3');
  expect(built.transcript).toHaveLength(4); // last 2 rounds only
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/core/context-builder.budget.test.ts`
Expected: FAIL with missing `applyContextBudget`

- [ ] **Step 3: Implement reserve splitting and transcript summarization**

```ts
export function applyContextBudget(input: BudgetInput): BudgetedContext {
  const transcriptReserve = Math.floor(input.contextBudget * 0.6);
  const staticReserve = input.contextBudget - transcriptReserve;
  const transcriptState = capTranscript(input.transcript, transcriptReserve);
  const fileState = capFiles(input.files, staticReserve - sizeOf(input.gitLog));
  return { ...fileState, ...transcriptState };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/core/context-builder.budget.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/context-builder.ts tests/core/context-builder.budget.test.ts
git commit -m "feat: add context budgeting and transcript summarization"
```

### Task 5: Implement Agreement Detection and Result Synthesis

**Files:**
- Create: `src/core/agreement-detector.ts`
- Create: `tests/core/agreement-detector.test.ts`

- [ ] **Step 1: Write the failing agreement-detector tests**

```ts
it('declares agreement on explicit convergence language', () => {
  const result = evaluateExchange({
    transcript: makeTranscript(['I agree, let us use the split adapter design.']),
  });

  expect(result.agreed).toBe(true);
  expect(result.decision).toContain('split adapter design');
  expect(result.keyDisagreements).toEqual([]);
});

it('returns a recommended path and disagreements when rounds are exhausted', () => {
  const result = synthesizeInconclusiveResult({
    transcript: makeDisagreeingTranscript(),
  });

  expect(result.agreed).toBe(false);
  expect(result.recommendedPath).not.toBe('');
  expect(result.peerPosition).not.toBe('');
  expect(result.keyDisagreements.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/core/agreement-detector.test.ts`
Expected: FAIL with missing detector exports

- [ ] **Step 3: Implement heuristic scoring and result synthesis**

```ts
export function evaluateExchange(state: DetectorState): DetectorResult {
  const score = signalScore(state.latestPeerResponse) + stabilityScore(state.transcript);
  return score >= 1
    ? buildAgreedResult(state)
    : buildPendingResult(state);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/core/agreement-detector.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/agreement-detector.ts tests/core/agreement-detector.test.ts
git commit -m "feat: add agreement detection and result synthesis"
```

### Task 6: Implement the Codex CLI Adapter

**Files:**
- Create: `src/adapters/adapter.ts`
- Create: `src/adapters/codex-cli.ts`
- Create: `tests/adapters/codex-cli.test.ts`
- Create: `tests/helpers/fake-process.ts`

- [ ] **Step 1: Write the failing adapter tests**

```ts
it('maps missing codex to ADAPTER_UNAVAILABLE', async () => {
  const adapter = new CodexCliAdapter({ which: async () => false });
  await expect(adapter.isAvailable()).resolves.toBe(false);
});

it('kills the subprocess and throws ADAPTER_TIMEOUT on timeout', async () => {
  const adapter = new CodexCliAdapter({ spawn: makeHungProcess() });
  await expect(adapter.sendMessage('prompt', baseContext)).rejects.toMatchObject({
    code: 'ADAPTER_TIMEOUT',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/adapters/codex-cli.test.ts`
Expected: FAIL with missing adapter files

- [ ] **Step 3: Implement adapter availability, subprocess execution, timeout handling, and stderr capture**

```ts
export class CodexCliAdapter implements Adapter {
  async sendMessage(prompt: string, context: DeliberationContext): Promise<string> {
    const child = this.spawnCodex(prompt, context);
    const result = await awaitProcess(child, this.timeoutMs);
    if (!result.stdout.trim()) throw new DeliberationError('Empty adapter response', 'ADAPTER_ERROR');
    return result.stdout.trim();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/adapters/codex-cli.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/adapter.ts src/adapters/codex-cli.ts tests/adapters/codex-cli.test.ts tests/helpers/fake-process.ts
git commit -m "feat: add codex cli adapter"
```

### Task 7: Implement the Deliberation Engine

**Files:**
- Create: `src/core/deliberation.ts`
- Modify: `src/index.ts`
- Create: `tests/core/deliberation.test.ts`

- [ ] **Step 1: Write the failing engine tests**

```ts
it('stops early when the detector reports agreement', async () => {
  const result = await runDeliberation({
    maxRounds: 5,
    mode: 'plan',
    adapter: makeAdapter(['I agree, use the split adapter design.']),
    context: baseContext,
  });

  expect(result.agreed).toBe(true);
  expect(result.rounds).toBe(1);
});

it('resends full budgeted context on every round', async () => {
  const adapter = makeRecordingAdapter(['Maybe split it', 'I still prefer splitting it']);
  await runDeliberation({ maxRounds: 2, mode: 'plan', adapter, context: baseContext });
  expect(adapter.calls[0].context.files).toBeDefined();
  expect(adapter.calls[1].context.files).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/core/deliberation.test.ts`
Expected: FAIL with missing engine

- [ ] **Step 3: Implement orchestration loop, detector integration, and adapter cleanup**

```ts
export async function runDeliberation(config: DeliberationConfig): Promise<DeliberationResult> {
  const state = createLoopState(config);
  for (let round = 1; round <= config.maxRounds; round += 1) {
    const prompt = buildPromptForRound(config.mode, state);
    const context = await buildRoundContext(config, state);
    const peerResponse = await config.adapter.sendMessage(prompt, context);
    updateTranscript(state, round, prompt, peerResponse);
    const evaluation = evaluateExchange(state);
    if (evaluation.agreed) return finalizeAgreedResult(state, evaluation);
  }
  return finalizeInconclusiveResult(state);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/core/deliberation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/deliberation.ts src/index.ts tests/core/deliberation.test.ts
git commit -m "feat: add deliberation engine"
```

### Task 8: Finish CLI Wiring, Skill Installation, and Docs

**Files:**
- Modify: `src/cli.ts`
- Modify: `package.json`
- Create: `skill/opinionate/skill.md`
- Create: `skill/opinionate/install.ts`
- Create: `tests/skill/install.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the failing install/docs tests**

```ts
it('copies the skill into .agents/skills/opinionate', async () => {
  await installSkill({ cwd: sandboxProject });
  expect(await pathExists(`${sandboxProject}/.agents/skills/opinionate/skill.md`)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/skill/install.test.ts`
Expected: FAIL with missing installer

- [ ] **Step 3: Implement the install script, finish CLI flag parsing, and document the JSON/stderr contract**

```ts
if (args[0] === 'run') {
  const result = await runDeliberation(makeConfigFromArgs(parsed));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
```

- [ ] **Step 4: Run the focused tests**

Run: `npm test -- --run tests/cli/cli.test.ts tests/skill/install.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and build**

Run: `npm test && npm run build`
Expected: PASS with emitted `dist/cli.js` and all tests green

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts package.json README.md skill/opinionate/skill.md skill/opinionate/install.ts tests/skill/install.test.ts
git commit -m "feat: add skill integration and runtime docs"
```

## Final Verification Checklist

- [ ] `npm test`
- [ ] `npm run build`
- [ ] `node dist/cli.js run --mode plan --task "Design auth" --cwd . --conversation-summary "Use OAuth2"` prints valid JSON to stdout
- [ ] `npx opinionate install` copies `skill/opinionate/skill.md` into a test `.agents/skills/opinionate/` directory
- [ ] README documents:
  - CLI flags
  - stdout JSON contract vs stderr progress output
  - `.opinionateignore` behavior
  - filename-only safety limitation
  - v1 limitation: structured peer deliberation, not a symmetric live two-agent chat
