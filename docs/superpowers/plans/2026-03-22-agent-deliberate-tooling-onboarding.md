# opinionate Tooling and Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `opinionate` reliably usable across real developer machines by hardening Codex CLI compatibility, model/default resolution, Claude skill installation, environment diagnostics, and runtime visibility into what Codex is actually doing during a deliberation run.

**Architecture:** Add a small runtime-configuration layer between the CLI and the Codex adapter. The CLI should resolve explicit flags and environment variables, then delegate Codex capability probing and default behavior to a dedicated utility that understands installed CLI versions and supported invocation styles. Onboarding should become deterministic: `install` writes the skill to Claude’s actual project-skill location, `doctor` verifies Codex, model, skill, and binary-link state before the user hits a runtime error, and a lightweight execution-trace layer records the exact peer command, model source, round timings, and raw peer stdout/stderr when the user opts into visibility.

**Tech Stack:** Node.js 18+, TypeScript, Vitest, `node:child_process`, `node:fs`, `node:path`, `node:os`.

---

## File Structure

- Modify: `package.json`
- Modify: `README.md`
- Modify: `src/cli.ts`
- Modify: `src/install.ts`
- Modify: `src/adapters/codex-cli.ts`
- Modify: `src/index.ts`
- Modify: `src/util/which.ts`
- Create: `src/core/runtime-config.ts`
- Create: `src/core/preflight.ts`
- Create: `src/core/execution-trace.ts`
- Create: `src/util/codex-cli-info.ts`
- Create: `src/util/claude-skill-paths.ts`
- Create: `src/__tests__/cli.test.ts`
- Create: `src/__tests__/codex-cli-info.test.ts`
- Create: `src/__tests__/runtime-config.test.ts`
- Create: `src/__tests__/preflight.test.ts`
- Create: `src/__tests__/execution-trace.test.ts`
- Create: `src/__tests__/install.test.ts`
- Modify: `src/__tests__/deliberation.test.ts`
- Modify: `skill/opinionate/skill.md`

## Scope Notes

- This plan is intentionally limited to tooling and onboarding reliability.
- Do not redesign the deliberation loop here.
- Do not add a general plugin system here.
- Prefer capability detection over version hardcoding wherever possible.
- Visibility must be opt-in or low-noise by default: normal runs stay concise, but verbose/trace runs must make Codex execution inspectable.
- Preflight must distinguish between "Codex binary missing", "Codex installed but not authenticated", and "Codex authenticated but model/account access is incompatible".

## Approach Options

**Option 1: Doc-only onboarding**
- Fastest to ship.
- Still leaves runtime failures when Codex CLI flags or Claude skill paths change.
- Reject.

**Option 2: Hardcoded compatibility matrix**
- Better than doc-only.
- Still brittle because Codex CLI and Claude skill discovery can change again.
- Accept only as a fallback for known breaking versions.

**Option 3: Capability-driven runtime with explicit doctor command**
- Highest implementation cost.
- Best user experience because the package can explain what it detected and what is missing before a deliberation run fails.
- Recommended.

### Task 1: Introduce Runtime Config Resolution

**Files:**
- Create: `src/core/runtime-config.ts`
- Modify: `src/cli.ts`
- Modify: `src/index.ts`
- Create: `src/__tests__/runtime-config.test.ts`

- [ ] **Step 1: Write the failing config-resolution tests**

```ts
it('prefers explicit cli flags over env and adapter defaults', () => {
  const resolved = resolveRuntimeConfig({
    argv: { model: 'gpt-5.4', timeout: '30000' },
    env: { OPINIONATE_MODEL: 'o4-mini' },
  });

  expect(resolved.model).toBe('gpt-5.4');
  expect(resolved.timeout).toBe(30000);
});

it('omits model override when none is provided so codex default is preserved', () => {
  const resolved = resolveRuntimeConfig({ argv: {}, env: {} });
  expect(resolved.model).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/runtime-config.test.ts`
Expected: FAIL with missing `resolveRuntimeConfig`

- [ ] **Step 3: Implement runtime config resolution**

```ts
export interface RuntimeConfig {
  model?: string;
  timeout: number;
  contextBudget: number;
  codexBin: string;
}

export function resolveRuntimeConfig(input: ResolveRuntimeConfigInput): RuntimeConfig {
  return {
    model: input.argv.model ?? input.env.OPINIONATE_MODEL,
    timeout: parseInt(input.argv.timeout ?? input.env.OPINIONATE_TIMEOUT ?? '60000', 10),
    contextBudget: parseInt(input.argv['context-budget'] ?? input.env.OPINIONATE_CONTEXT_BUDGET ?? '50000', 10),
    codexBin: input.argv['codex-bin'] ?? input.env.OPINIONATE_CODEX_BIN ?? 'codex',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/__tests__/runtime-config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/runtime-config.ts src/cli.ts src/index.ts src/__tests__/runtime-config.test.ts
git commit -m "feat: add runtime config resolution"
```

### Task 2: Add Codex CLI Capability Detection

**Files:**
- Create: `src/util/codex-cli-info.ts`
- Modify: `src/adapters/codex-cli.ts`
- Modify: `src/util/which.ts`
- Create: `src/__tests__/codex-cli-info.test.ts`

- [ ] **Step 1: Write the failing Codex capability tests**

```ts
it('detects exec support from codex help output', async () => {
  const info = await detectCodexCliInfo({
    codexBin: 'codex',
    execFile: fakeExecFile({
      'codex --version': 'codex-cli 0.116.0',
      'codex exec --help': 'Usage: codex exec [OPTIONS] [PROMPT] [COMMAND]',
    }),
  });

  expect(info.version).toBe('0.116.0');
  expect(info.supportsExec).toBe(true);
});

it('marks model flag availability separately from exec support', async () => {
  const info = await detectCodexCliInfo({
    codexBin: 'codex',
    execFile: fakeExecFile({
      'codex --version': 'codex-cli 0.71.0',
      'codex exec --help': 'Usage: codex exec [OPTIONS] [PROMPT] [COMMAND]',
    }),
  });

  expect(info.supportsExec).toBe(true);
  expect(info.supportsModelFlag).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/codex-cli-info.test.ts`
Expected: FAIL with missing `detectCodexCliInfo`

- [ ] **Step 3: Implement Codex CLI probing**

```ts
export interface CodexCliInfo {
  version: string | null;
  supportsExec: boolean;
  supportsModelFlag: boolean;
  rawVersion: string | null;
}

export async function detectCodexCliInfo(input: DetectCodexCliInfoInput): Promise<CodexCliInfo> {
  const rawVersion = await runText(input.codexBin, ['--version']);
  const execHelp = await runText(input.codexBin, ['exec', '--help']);
  return {
    version: parseCodexVersion(rawVersion),
    rawVersion,
    supportsExec: execHelp.includes('Usage: codex exec'),
    supportsModelFlag: /\s-m[,\s]/.test(execHelp) || execHelp.includes('--model'),
  };
}
```

- [ ] **Step 4: Update `CodexCliAdapter` to choose invocation based on detected capabilities**

```ts
if (!info.supportsExec) {
  throw new DeliberationError('Installed Codex CLI does not support non-interactive exec mode', 'ADAPTER_UNAVAILABLE');
}

const args = ['exec'];
if (this.model && info.supportsModelFlag) args.push('-m', this.model);
if (this.model && !info.supportsModelFlag) args.push('-c', `model="${this.model}"`);
args.push(prompt);
```

- [ ] **Step 5: Run focused tests**

Run: `pnpm test -- src/__tests__/codex-cli-info.test.ts src/__tests__/deliberation.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/util/codex-cli-info.ts src/adapters/codex-cli.ts src/util/which.ts src/__tests__/codex-cli-info.test.ts src/__tests__/deliberation.test.ts
git commit -m "feat: detect codex cli capabilities at runtime"
```

### Task 3: Add Preflight and Doctor Command

**Files:**
- Create: `src/core/preflight.ts`
- Modify: `src/cli.ts`
- Create: `src/__tests__/preflight.test.ts`
- Create: `src/__tests__/cli.test.ts`

- [ ] **Step 1: Write the failing doctor/preflight tests**

```ts
it('reports missing codex and missing skill installation with actionable guidance', async () => {
  const result = await runDoctor({
    cwd: '/tmp/project',
    codexInfo: null,
    skillInstalled: false,
  });

  expect(result.ok).toBe(false);
  expect(result.issues).toEqual(
    expect.arrayContaining([
      expect.stringContaining('Codex CLI not found'),
      expect.stringContaining('.claude/skills/opinionate/SKILL.md'),
    ]),
  );
});

it('prints doctor output to stderr and exits 0 when environment is ready', async () => {
  const exitCode = await runCli(['node', 'opinionate', 'doctor'], fakeDepsReady());
  expect(exitCode).toBe(0);
});

it('reports installed-but-unauthenticated codex separately from missing binary', async () => {
  const result = await runDoctor({
    cwd: '/tmp/project',
    codexInfo: {
      version: '0.116.0',
      rawVersion: 'codex-cli 0.116.0',
      supportsExec: true,
      supportsModelFlag: true,
    },
    codexAuth: { ok: false, reason: 'not_authenticated' },
    skillInstalled: true,
  });

  expect(result.ok).toBe(false);
  expect(result.issues).toEqual(
    expect.arrayContaining([expect.stringContaining('codex login')]),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/preflight.test.ts src/__tests__/cli.test.ts`
Expected: FAIL with missing `runDoctor` or `doctor` command

- [ ] **Step 3: Implement preflight checks**

```ts
export interface DoctorResult {
  ok: boolean;
  codex: CodexCliInfo | null;
  codexAuth?: {
    ok: boolean;
    reason?: 'not_authenticated' | 'model_unavailable' | 'exec_failed';
    detail?: string;
  };
  skillInstalled: boolean;
  linkedBinaryPath?: string | null;
  issues: string[];
  suggestions: string[];
}
```

- [ ] **Step 4: Extend CLI with `doctor`**

Run behavior:
- `opinionate doctor` checks:
  - Codex binary exists
  - detected version and non-interactive support
  - whether Codex is authenticated enough to run non-interactive exec
  - whether the requested model is usable by the current Codex account/config
  - whether a model override is configured or defaults will be inherited
  - whether `.claude/skills/opinionate/SKILL.md` exists in the target project
  - whether the current `opinionate` binary resolves to the expected install

Implementation note:
- Prefer a lightweight auth/capability probe over guessing from config files alone.
- Acceptable probe order:
  1. inspect known Codex config/state files if present
  2. if still unclear, run a minimal non-destructive `codex exec` probe with a tiny prompt and short timeout
- Doctor output must separate:
  - binary not found
  - exec unsupported by this Codex version
  - not authenticated / login required
  - authenticated, but requested model is not available to the account

- [ ] **Step 5: Run focused tests**

Run: `pnpm test -- src/__tests__/preflight.test.ts src/__tests__/cli.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/preflight.ts src/cli.ts src/__tests__/preflight.test.ts src/__tests__/cli.test.ts
git commit -m "feat: add onboarding doctor command"
```

### Task 4: Make Claude Skill Installation Deterministic

**Files:**
- Create: `src/util/claude-skill-paths.ts`
- Modify: `src/install.ts`
- Modify: `skill/opinionate/skill.md`
- Create: `src/__tests__/install.test.ts`

- [ ] **Step 1: Write the failing install tests**

```ts
it('installs the deliberate skill to .claude/skills/opinionate/SKILL.md', async () => {
  await installSkill(sandboxProject);
  expect(existsSync(join(sandboxProject, '.claude', 'skills', 'deliberate', 'SKILL.md'))).toBe(true);
});

it('is idempotent when run twice', async () => {
  await installSkill(sandboxProject);
  await installSkill(sandboxProject);
  expect(readFileSync(join(sandboxProject, '.claude', 'skills', 'deliberate', 'SKILL.md'), 'utf8')).toContain('name: deliberate');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/install.test.ts`
Expected: FAIL with missing tests or missing helpers

- [ ] **Step 3: Extract skill-path helpers and harden installer messages**

```ts
export function getClaudeProjectSkillDir(cwd: string): string {
  return join(cwd, '.claude', 'skills', 'deliberate');
}

export function getClaudeProjectSkillFile(cwd: string): string {
  return join(getClaudeProjectSkillDir(cwd), 'SKILL.md');
}
```

- [ ] **Step 4: Update installer stderr output to include verification guidance**

Expected message content:
- installed path
- reminder to restart Claude session
- suggestion to run `opinionate doctor`

- [ ] **Step 5: Run focused tests**

Run: `pnpm test -- src/__tests__/install.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/util/claude-skill-paths.ts src/install.ts skill/opinionate/skill.md src/__tests__/install.test.ts
git commit -m "feat: harden claude skill installation"
```

### Task 5: Separate User Config From Adapter Defaults

**Files:**
- Modify: `src/adapters/codex-cli.ts`
- Modify: `src/cli.ts`
- Modify: `README.md`
- Modify: `src/index.ts`
- Modify: `src/__tests__/deliberation.test.ts`
- Modify: `src/__tests__/cli.test.ts`

- [ ] **Step 1: Write the failing model-resolution tests**

```ts
it('passes no model flag to codex when the user did not override model', async () => {
  const adapter = new CodexCliAdapter({ timeout: 1000 });
  const args = adapter.buildExecArgsForTest('hello', { supportsExec: true, supportsModelFlag: true });
  expect(args).toEqual(['exec', 'hello']);
});

it('passes model override when explicitly configured', async () => {
  const adapter = new CodexCliAdapter({ timeout: 1000, model: 'gpt-5.4' });
  const args = adapter.buildExecArgsForTest('hello', { supportsExec: true, supportsModelFlag: true });
  expect(args).toEqual(['exec', '-m', 'gpt-5.4', 'hello']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/cli.test.ts src/__tests__/deliberation.test.ts`
Expected: FAIL because exec-arg construction is not isolated/testable

- [ ] **Step 3: Refactor the adapter so model selection is explicit**

Rules:
- CLI `--model` overrides everything
- `OPINIONATE_MODEL` is the next fallback
- if neither is set, the adapter does not inject a model and Codex’s own default applies
- doctor output must say whether the run will use:
  - explicit override
  - environment override
  - Codex default

- [ ] **Step 4: Run focused tests**

Run: `pnpm test -- src/__tests__/cli.test.ts src/__tests__/deliberation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/codex-cli.ts src/cli.ts README.md src/index.ts src/__tests__/deliberation.test.ts src/__tests__/cli.test.ts
git commit -m "feat: clarify model resolution and defaults"
```

### Task 6: Add Execution Visibility and Trace Artifacts

**Files:**
- Create: `src/core/execution-trace.ts`
- Modify: `src/adapters/codex-cli.ts`
- Modify: `src/cli.ts`
- Modify: `src/index.ts`
- Create: `src/__tests__/execution-trace.test.ts`
- Modify: `src/__tests__/cli.test.ts`
- Modify: `src/__tests__/deliberation.test.ts`

- [ ] **Step 1: Write the failing execution-visibility tests**

```ts
it('prints the exact codex command and round metadata in verbose mode', async () => {
  const io = createMemoryIO();

  await runCli(
    ['node', 'opinionate', 'run', '--mode', 'review', '--task', 'Check PR', '--verbose'],
    fakeDepsWithTrace(io),
  );

  expect(io.stderr()).toContain('codex exec');
  expect(io.stderr()).toContain('Round 1');
  expect(io.stderr()).toContain('model source');
});

it('writes per-round stdout and stderr artifacts when trace-dir is configured', async () => {
  const trace = createExecutionTrace({ traceDir: sandboxDir, verbose: false });
  await trace.recordRoundResult({
    round: 1,
    command: ['codex', 'exec', 'hello'],
    stdout: 'peer output',
    stderr: 'peer diagnostics',
    exitCode: 0,
    durationMs: 1200,
  });

  expect(readFileSync(join(sandboxDir, 'round-1.json'), 'utf8')).toContain('peer diagnostics');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/execution-trace.test.ts src/__tests__/cli.test.ts`
Expected: FAIL with missing trace helpers or verbose output

- [ ] **Step 3: Implement a dedicated execution-trace layer**

Required behavior:
- CLI flags:
  - `--verbose` for human-readable stderr progress
  - `--trace-dir <path>` to persist round artifacts
  - `--show-peer-command` to print the exact Codex command line
  - `--show-peer-output` to stream or replay peer stderr/stdout safely to stderr
- Each round should capture:
  - round number
  - detected Codex version/capabilities
  - resolved model and model source
  - exact argv used for Codex
  - child pid when available
  - duration
  - exit code or signal
  - raw stdout and stderr

- [ ] **Step 4: Thread trace hooks through the adapter and CLI**

Implementation rules:
- Normal run: keep current minimal stderr output.
- Verbose run: print high-signal trace lines only.
- Trace-dir run: write JSON artifacts without changing stdout result format.
- Never mix trace payloads into stdout; stdout remains only `DeliberationResult` JSON.

```ts
trace.onRoundStart({ round, command, model, modelSource });
trace.onPeerStderr(chunk);
trace.onRoundFinish({ round, exitCode, durationMs, stdout, stderr });
```

- [ ] **Step 5: Run focused tests**

Run: `pnpm test -- src/__tests__/execution-trace.test.ts src/__tests__/cli.test.ts src/__tests__/deliberation.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/execution-trace.ts src/adapters/codex-cli.ts src/cli.ts src/index.ts src/__tests__/execution-trace.test.ts src/__tests__/cli.test.ts src/__tests__/deliberation.test.ts
git commit -m "feat: add codex execution visibility and trace artifacts"
```

### Task 7: Document Real Onboarding Flows

**Files:**
- Modify: `README.md`
- Modify: `skill/opinionate/skill.md`
- Modify: `package.json`

- [ ] **Step 1: Write the docs acceptance checklist in the README**

Required sections:
- local development install via `npm link` or `pnpm link --global`
- project skill install path: `.claude/skills/opinionate/SKILL.md`
- `opinionate doctor`
- how model selection works
- how to inspect what Codex actually did during a run
- how to test inside another project
- what to do when Codex auth fails (`codex login`) or model/account access fails

- [ ] **Step 2: Update skill instructions to align with actual install/runtime behavior**

The skill text must reference:
- `opinionate run`
- `.claude/skills`
- `opinionate doctor` as the first debugging step for setup failures
- `--verbose` / `--trace-dir` when the user wants to inspect peer execution

- [ ] **Step 3: Make package metadata reflect reality**

Update:
- `description`
- keywords if needed
- possibly add a `doctor` example in the help text or README quick start

- [ ] **Step 4: Verify docs manually**

Run:
```bash
pnpm build
pnpm test
node dist/src/cli.js doctor
node dist/src/install.js
node dist/src/cli.js run --mode review --task "inspect" --verbose --trace-dir .opinionate/runs/test
```

Expected:
- build passes
- tests pass
- doctor prints actionable diagnostics
- install prints the exact skill target path
- verbose run prints Codex execution details to stderr and writes trace files

- [ ] **Step 5: Commit**

```bash
git add README.md skill/opinionate/skill.md package.json
git commit -m "docs: add onboarding and troubleshooting guides"
```

## Final Verification Checklist

- [ ] `pnpm build`
- [ ] `pnpm test`
- [ ] `node dist/src/cli.js doctor` on a machine without Codex prints useful remediation
- [ ] `node dist/src/cli.js doctor --model gpt-5.4` reports explicit override
- [ ] `node dist/src/cli.js doctor` with Codex installed but logged out reports an auth-specific remediation path
- [ ] `node dist/src/cli.js doctor --model <unsupported-model>` reports a model/account compatibility failure distinct from auth failure
- [ ] `node dist/src/cli.js run --mode plan --task "test" --cwd .` omits `-m` when no model override is provided
- [ ] `node dist/src/cli.js run --mode review --task "inspect" --verbose --show-peer-command` prints the exact Codex invocation and round lifecycle to stderr
- [ ] `node dist/src/cli.js run --mode review --task "inspect" --trace-dir .opinionate/runs/test` writes per-round JSON artifacts with stdout, stderr, exit code, and duration
- [ ] `node dist/src/install.js` writes `.claude/skills/opinionate/SKILL.md`
- [ ] Installing into a second project and restarting Claude surfaces the skill under project skills
- [ ] README includes a copy-paste flow for:
  - local package development
  - linked binary use in another repo
  - diagnosing Codex version/model/auth failures
  - inspecting Codex execution with verbose and trace modes
