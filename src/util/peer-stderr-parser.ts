export interface PeerDiagnostic {
  type: 'mcp-failure' | 'mcp-starting' | 'model-info' | 'tool-execution' | 'response';
  severity: 'warning' | 'info';
  message: string;
}

const PATTERNS: Array<{
  regex: RegExp;
  build: (match: RegExpMatchArray) => PeerDiagnostic | null;
}> = [
  {
    regex: /^mcp: (\S+) failed: (.+)$/i,
    build: (match) => ({
      type: 'mcp-failure',
      severity: 'warning',
      message: `peer MCP server '${match[1]}' failed: ${match[2]}`,
    }),
  },
  {
    regex: /^mcp: (\S+) starting$/i,
    build: (match) => ({
      type: 'mcp-starting',
      severity: 'info',
      message: `peer MCP server '${match[1]}' starting...`,
    }),
  },
  {
    regex: /^mcp startup: no servers$/i,
    build: () => null,
  },
  {
    regex: /^reasoning effort: (.+)$/i,
    build: (match) => ({
      type: 'model-info',
      severity: match[1]?.trim().toLowerCase() === 'xhigh' ? 'warning' : 'info',
      message: `Peer reasoning effort: ${match[1]?.trim()}`,
    }),
  },
  {
    regex: /^model: (.+)$/i,
    build: (match) => ({
      type: 'model-info',
      severity: 'info',
      message: `Peer model: ${match[1]?.trim()}`,
    }),
  },
  {
    regex: /^codex$/i,
    build: () => ({
      type: 'response',
      severity: 'info',
      message: 'peer is responding...',
    }),
  },
  {
    regex: /succeeded in \d+ms$/i,
    build: () => ({
      type: 'tool-execution',
      severity: 'info',
      message: 'peer executed tool',
    }),
  },
];

export function parsePeerStderr(chunk: string): PeerDiagnostic[] {
  const diagnostics: PeerDiagnostic[] = [];

  for (const rawLine of chunk.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    for (const { regex, build } of PATTERNS) {
      const match = line.match(regex);
      if (!match) {
        continue;
      }

      const diagnostic = build(match);
      if (diagnostic) {
        diagnostics.push(diagnostic);
      }
      break;
    }
  }

  return diagnostics;
}
