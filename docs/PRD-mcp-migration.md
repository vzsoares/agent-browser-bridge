# PRD — Migrate from pi-extension to MCP server

**Status:** in progress (scaffolding pass complete)
**Author:** vzsoares
**Date:** 2026-05-19

## Motivation

The previous adapter layer was hard-wired to [pi](https://github.com/mariozechner/pi) via `@mariozechner/pi-coding-agent`. To make the bridge usable by *any* coding agent, we want a transport that's already a published standard with multiple compatible clients.

The Model Context Protocol (MCP) covers Claude Code, Claude Desktop, Cursor, and a growing set of clients with a single integration. That makes one MCP server functionally equivalent to N agent-specific adapters.

## Goals

1. Replace the pi adapter with an MCP server while preserving the existing domain / application / infrastructure layers (they're already agent-agnostic).
2. First-class support for Claude Code via stdio transport.
3. Keep the WebSocket relay + Chrome extension intact.
4. Drop pi entirely — no compat shims, no dual adapter.

## Non-goals (this pass)

- New tools.
- Reworking the WebSocket failover / multi-instance logic.
- A configuration UI for the MCP server.

## Design summary

- **Workspace rename**: `pi-extension/` → `bridge/`, package scope `@pi-browser-bridge/*` → `@agent-browser-bridge/*`, env var `PI_BROWSER_PORT` → `AGENT_BROWSER_PORT`, log env `PI_BROWSER_BRIDGE_LOG_LEVEL` → `AGENT_BROWSER_BRIDGE_LOG_LEVEL`.
- **Adapter layer** (`bridge/src/adapters/`) rewritten: every tool now reuses the existing Zod schema from `domain/schemas.ts` (`Schema.shape` is passed straight to MCP's `registerTool` as `inputSchema`). The pi-specific TypeBox duplicates are gone.
- **New stdio entry point** at `bridge/src/mcp/server.ts`. Boots both the WebSocket relay and the MCP server inside one process so a single `bun bridge/src/mcp/server.ts` is the user-facing run command.
- **Stdio safety**: the logger now writes to stderr only — stdout is reserved for the JSON-RPC channel.
- **Legacy `bridge/src/tools/`** (pi-shaped duplicates) deleted along with the `legacy*Tool` re-exports.

## User-facing change

```bash
# Before
pi.register(await import("@pi-browser-bridge/pi-extension"))

# After
claude mcp add --transport stdio --scope user agent-browser-bridge \
  -- bun /absolute/path/to/agent-browser-bridge/bridge/src/mcp/server.ts
```

## Open follow-ups

- Test suite: `bridge/src/__tests__/server.test.ts` and `tools.test.ts` referenced pi types; need a sweep to align with the new adapter shape.
- Mutation tests / Stryker config: verify after the rename.
- Consider publishing the MCP server as a standalone npm package so `npx agent-browser-bridge-mcp` works without a clone.
