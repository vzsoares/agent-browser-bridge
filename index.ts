/**
 * agent-browser-bridge — WebSocket-only dev runner.
 *
 * Starts just the WebSocket server that the Chrome extension connects to.
 * Useful for browser-side debugging (e.g. when iterating on the chrome
 * extension without going through MCP).
 *
 * To run the full MCP server (so a Claude / MCP-compatible agent can drive
 * the browser), use the dedicated stdio entry point instead:
 *
 *   bun bridge/src/mcp/server.ts
 *
 * That entry point starts both the WebSocket bridge and the MCP server.
 */

import { logger } from "@agent-browser-bridge/logger";
import { start } from "./bridge/src/infrastructure/ws-server.js";

const port = Number(process.env.AGENT_BROWSER_PORT) || 9242;

logger.info(`Starting WebSocket server on ws://localhost:${port}`);
const handle = await start(port);

logger.info(
	`Ready on port ${handle.port}. Waiting for Chrome extension connection…`,
);
