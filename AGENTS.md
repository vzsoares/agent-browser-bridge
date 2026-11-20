# AGENTS.md — agent-browser-bridge

MCP server that bridges any MCP-compatible coding agent (Claude Code, Claude Desktop, Cursor, …) to a real browser via a Chrome extension. Eleven `browser_*` tools.

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Bun](https://bun.com) v1.3+ |
| Language | TypeScript (strict mode) |
| MCP SDK | `@modelcontextprotocol/sdk` (stdio transport) |
| Validation | `zod` (shared schemas across MCP input + use cases) |
| Server runtime | `Bun.serve` WebSocket server (Hono for plain HTTP), `ws` client for failover |
| Package manager | Bun (workspaces) |

## Common Commands

```bash
bun install                       # Install dependencies
bun run bridge/src/mcp/server.ts  # Start the MCP server (stdio) + WS relay
bun run index.ts                  # Start only the WebSocket relay (dev/debug)
bun run typecheck                 # Project-wide tsc
bun run lint                      # Biome lint
bun run fix                       # Biome lint + format auto-fix
bun run test                      # bun:test for protocol + bridge packages
```

## Project Structure

```
.
├── index.ts                     # WS-only dev runner
├── bridge/                      # MCP server workspace
│   └── src/
│       ├── mcp/server.ts        # ← stdio MCP entry point
│       ├── adapters/            # MCP tool registrations (thin)
│       ├── application/         # Use cases (agent-agnostic)
│       ├── domain/              # Zod schemas, ports, errors
│       └── infrastructure/      # Hono + WS server, transport, failover
├── chrome-extension/            # Manifest V3 extension
├── protocol/                    # Shared wire-protocol types
├── logger/                      # Stderr-only namespaced logger
└── docs/
```

## Conventions

- **Module system**: ESM (`"type": "module"`)
- **TypeScript**: strict mode, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`
- **Schemas**: Zod, defined once in `bridge/src/domain/schemas.ts`; the adapter layer reuses `.shape` for MCP `inputSchema`
- **Logging**: always via `@agent-browser-bridge/logger`; the logger writes to stderr so it never collides with the MCP JSON-RPC channel on stdout
- **Layering** (enforced by Biome `noRestrictedImports`):
  - `domain/` ← (nothing)
  - `application/` ← `domain/`
  - `infrastructure/` ← `domain/`
  - `adapters/` ← any of the above; this is where MCP-specific shape lives

## Adding a new browser tool

1. Add the protocol types in `protocol/src/protocol.ts` (params + action name).
2. Add a Zod schema in `bridge/src/domain/schemas.ts`.
3. Implement the use case in `bridge/src/application/<tool>-usecase.ts`.
4. Implement the chrome-side handler in `chrome-extension/src/application/`.
5. Write a thin MCP adapter in `bridge/src/adapters/<tool>.ts` and add it to `bridge/src/adapters/index.ts#tools`.

## Skills

Inherits the workspace `.agents/skills/` directory.
