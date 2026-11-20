/**
 * agent-browser-bridge — WebSocket-only dev runner.
 *
 * Starts just the WebSocket server the Chrome extension connects to, for
 * iterating on the extension without MCP. The full server (WebSocket +
 * MCP over stdio) is `bun bridge/src/mcp/server.ts`.
 */

import { logger } from "@agent-browser-bridge/logger";
import { start } from "./bridge/src/infrastructure/ws-server.js";

const handle = await start();

logger.info(
	`Ready on port ${handle.port}. Waiting for Chrome extension connection…`,
);
