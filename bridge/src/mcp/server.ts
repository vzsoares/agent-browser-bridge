#!/usr/bin/env bun
/**
 * Stdio MCP server entry point.
 *
 * Starts the WebSocket bridge the Chrome extension connects to, then serves
 * the browser tools over stdio. stdout carries JSON-RPC only; logs go to
 * stderr.
 *
 *   claude mcp add --transport stdio --scope user agent-browser-bridge \
 *     -- bun /absolute/path/to/bridge/src/mcp/server.ts
 *
 * @module mcp/server
 */

import { createLogger } from "@agent-browser-bridge/logger";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import pkg from "../../package.json" with { type: "json" };
import { registerAllTools } from "../adapters/index.js";
import {
	start as startBridgeServer,
	stop as stopBridgeServer,
} from "../infrastructure/ws-server.js";

const logger = createLogger("bridge:mcp");

export function createMcpServer(): McpServer {
	const server = new McpServer({
		name: "agent-browser-bridge",
		version: pkg.version,
	});
	registerAllTools(server);
	return server;
}

async function main(): Promise<void> {
	const handle = await startBridgeServer();
	logger.info(`WebSocket bridge on port ${handle.port}`);

	const server = createMcpServer();
	await server.connect(new StdioServerTransport());
	logger.info("MCP server connected over stdio.");

	let closing = false;
	const shutdown = async (reason: string) => {
		if (closing) return;
		closing = true;
		logger.info(`${reason}, shutting down…`);
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
	process.stdin.on("end", () => void shutdown("stdin closed"));
}

if (import.meta.main) {
	main().catch((err) => {
		logger.error("Fatal error starting MCP server:", err);
		process.exit(1);
	});
}
