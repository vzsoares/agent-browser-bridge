/** MCP server: the tool list, and stdout carrying only JSON-RPC. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../mcp/server.js";
import { tempTokenFiles } from "./bridge-test-helpers.js";

const TOOL_NAMES = [
	"browser_click",
	"browser_close_tab",
	"browser_create_tab",
	"browser_exec",
	"browser_list_tabs",
	"browser_navigate",
	"browser_read",
	"browser_screenshot",
	"browser_type",
	"browser_wait_for_element",
	"browser_wait_for_text",
];

describe("MCP server", () => {
	test("tools/list returns the 11 browser tools", async () => {
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		const server = createMcpServer();
		await server.connect(serverSide);
		const client = new Client({ name: "test", version: "0.0.0" });
		await client.connect(clientSide);

		const { tools } = await client.listTools();
		expect(tools.map((t) => t.name).sort()).toEqual(TOOL_NAMES);
		for (const tool of tools) {
			expect(tool.description).toContain("the user's real, logged-in Chrome");
		}
		await client.close();
		await server.close();
	});

	test("stdio: stdout is JSON-RPC only and the pairing token is never logged", async () => {
		const { dir } = tempTokenFiles();
		const proc = Bun.spawn(["bun", join(import.meta.dir, "../mcp/server.ts")], {
			env: {
				...process.env,
				HOME: dir,
				AGENT_BROWSER_PORT: "0",
				AGENT_BROWSER_CLIENT: "off",
				AGENT_BROWSER_BRIDGE_LOG_LEVEL: "debug",
			},
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});

		const write = (msg: object) => {
			proc.stdin.write(`${JSON.stringify(msg)}\n`);
		};
		write({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "test", version: "0.0.0" },
			},
		});
		write({ jsonrpc: "2.0", method: "notifications/initialized" });
		write({ jsonrpc: "2.0", id: 2, method: "tools/list" });

		const reader = proc.stdout.getReader();
		const decoder = new TextDecoder();
		let out = "";
		const deadline = Date.now() + 10_000;
		while (Date.now() < deadline && !out.includes('"id":2')) {
			const { value, done } = await reader.read();
			if (done) break;
			out += decoder.decode(value);
		}
		reader.releaseLock();

		// Closing stdin is how pi stops a stdio server.
		proc.stdin.end();
		expect(await proc.exited).toBe(0);
		const stderr = await new Response(proc.stderr).text();

		const lines = out.split("\n").filter((l) => l.trim().length > 0);
		expect(lines.length).toBeGreaterThanOrEqual(2);
		for (const line of lines) {
			const msg: unknown = JSON.parse(line);
			expect(msg).toMatchObject({ jsonrpc: "2.0" });
		}
		const list: unknown = JSON.parse(lines[lines.length - 1] ?? "{}");
		expect(list).toMatchObject({ id: 2 });
		expect(stderr).toContain("Owner server listening");

		const token = readFileSync(
			join(dir, ".config/agent-browser-bridge/pair.token"),
			"utf8",
		).trim();
		expect(token).toMatch(/^[0-9a-f]{64}$/);
		expect(stderr).not.toContain(token);
		expect(out).not.toContain(token);
	});
});
