# Development

## Local Setup

```bash
pnpm install
pnpm build
pnpm test
```

## Link globally for testing

```bash
npm link
cd /path/to/other-project
opinionate install
opinionate doctor
```

Or without linking:

```bash
node /path/to/opinionate/dist/src/cli.js install
```

## Testing in another project

1. `pnpm build`
2. Link or use the full path
3. `opinionate install` in the target project
4. Restart Claude Code
5. `opinionate doctor --cwd /path/to/project`

## Library API

```typescript
import { Deliberation, CodexCliAdapter } from 'opinionate';

const result = await new Deliberation({
  mode: 'plan',
  peerAdapter: new CodexCliAdapter({ timeout: 60_000 }),
  context: {
    task: 'Design the caching layer',
    files: [{ path: 'src/cache.ts', content: '...' }],
    cwd: '/path/to/project',
  },
  maxRounds: 5,
  timeout: 60_000,
  contextBudget: 50_000,
}).run();
```

## Writing a Custom Adapter

Implement the `Adapter` interface:

```typescript
import type { Adapter, DeliberationContext } from 'opinionate';

class MyAdapter implements Adapter {
  name = 'my-adapter';
  async initialize() {}
  async isAvailable() { return true; }
  async sendMessage(prompt: string, context: DeliberationContext) {
    return await myLlm.complete(prompt);
  }
  async cleanup() {}
}
```

## Architecture

```
src/
├── core/
│   ├── types.ts              # Interfaces, error types, defaults
│   ├── deliberation.ts       # Main loop engine
│   ├── context-builder.ts    # Context budgeting + safety filtering
│   ├── agreement-detector.ts # Heuristic convergence detection
│   ├── session-store.ts      # Persistent session storage
│   ├── session-memory.ts     # Session memory synthesis
│   ├── preflight.ts          # doctor command logic
│   ├── runtime-config.ts     # CLI/env resolution
│   └── execution-trace.ts    # verbose/trace artifacts
├── adapters/
│   └── codex-cli.ts          # Codex CLI adapter
├── cli.ts                    # CLI entrypoint
├── install.ts                # Skill installer
├── util/
│   ├── format.ts             # Box rendering, color support
│   ├── terminal-reporter.ts  # Styled deliberation progress
│   ├── codex-cli-info.ts     # Codex capability/auth probing
│   ├── codex-config.ts       # Reads Codex config
│   ├── file-snapshot.ts      # File hashing and delta generation
│   ├── peer-stderr-parser.ts # Curated peer stderr diagnostics
│   ├── session-paths.ts      # Session directory helpers
│   └── claude-skill-paths.ts # Claude skill path helpers
└── index.ts                  # Public API
```
