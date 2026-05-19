#!/usr/bin/env bun
/**
 * Stdio MCP server entry point.
 *
 * Boots an {@link McpServer}, registers all browser-automation tools, and
 * connects it to the stdio transport. In parallel, starts the WebSocket
 * server that the Chrome extension connects to — both run inside the same
 * process so a single `bun src/mcp/server.ts` command yields a fully
 * functional bridge.
 *
 * Register with Claude Code:
 *
 *   claude mcp add --transport stdio --scope user agent-browser-bridge \
 *     -- bun /absolute/path/to/bridge/src/mcp/server.ts
 *
 * @module mcp/server
 */

import { createLogger } from "@agent-browser-bridge/logger";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerAllTools } from "../adapters/index.js";
import {
	start as startBridgeServer,
	stop as stopBridgeServer,
} from "../infrastructure/ws-server.js";

const logger = createLogger("bridge:mcp");

async function main(): Promise<void> {
	// 1) Start the WebSocket bridge so the Chrome extension can connect.
	const port = Number(process.env.AGENT_BROWSER_PORT) || 9242;
	const handle = await startBridgeServer(port);
	logger.info(`WebSocket bridge listening on ws://localhost:${handle.port}`);

	// 2) Build the MCP server and register every browser tool.
	const server = new McpServer({
		name: "agent-browser-bridge",
		version: "0.1.0",
	});
	registerAllTools(server);

	// 3) Wire stdio transport. The MCP SDK takes over stdin/stdout from here.
	const transport = new StdioServerTransport();
	await server.connect(transport);
	logger.info("MCP server connected over stdio.");

	// 4) Graceful shutdown.
	const shutdown = async (signal: string) => {
		logger.info(`Received ${signal}, shutting down…`);
		try {
			await server.close();
		} catch (err) {
			logger.error("Error closing MCP server:", err);
		}
		stopBridgeServer();
		process.exit(0);
	};
	process.on("SIGINT", () => void shutdown("SIGINT"));
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
	logger.error("Fatal error starting MCP server:", err);
	process.exit(1);
});
