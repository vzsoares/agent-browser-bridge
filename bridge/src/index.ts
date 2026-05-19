// @agent-browser-bridge/bridge — package barrel export.
//
// Re-exports the adapter-layer tool definitions, schemas, and lifecycle
// helpers used by the MCP server entry point. Consumers should normally
// run the MCP server directly via `bun src/mcp/server.ts`.

export * from "./adapters/index.js";
export { onResponse, send, start, stop } from "./infrastructure/ws-server.js";
