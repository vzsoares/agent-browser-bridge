/**
 * Calls browser tools through a real in-memory MCP client, so input
 * validation is the SDK's own, as in production.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "../mcp/server.js";

const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await createMcpServer().connect(serverSide);
const client = new Client({ name: "tool-tests", version: "0.0.0" });
await client.connect(clientSide);
const { tools } = await client.listTools();

export function toolSchema(name: string): Tool["inputSchema"] {
	const tool = tools.find((t) => t.name === name);
	if (!tool) throw new Error(`no tool ${name}`);
	return tool.inputSchema;
}

/** Call a tool; invalid input comes back as an `isError` result. */
export async function callTool(
	name: string,
	args: unknown,
): Promise<CallToolResult> {
	const params =
		typeof args === "object" && args !== null && !Array.isArray(args)
			? Object.fromEntries(Object.entries(args))
			: {};
	try {
		return await client.callTool(
			{ name, arguments: params },
			CallToolResultSchema,
			{ timeout: 60_000 },
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { isError: true, content: [{ type: "text", text: message }] };
	}
}

const tool = (name: string) => (args: unknown) => callTool(name, args);

export const browserNavigate = tool("browser_navigate");
export const browserClick = tool("browser_click");
export const browserType = tool("browser_type");
export const browserRead = tool("browser_read");
export const browserScreenshot = tool("browser_screenshot");
export const browserExec = tool("browser_exec");
export const browserWaitForElement = tool("browser_wait_for_element");
export const browserWaitForText = tool("browser_wait_for_text");

export const BROWSER_NAVIGATE_SCHEMA = toolSchema("browser_navigate");
export const BROWSER_CLICK_SCHEMA = toolSchema("browser_click");
export const BROWSER_TYPE_SCHEMA = toolSchema("browser_type");
export const BROWSER_READ_SCHEMA = toolSchema("browser_read");
export const BROWSER_SCREENSHOT_SCHEMA = toolSchema("browser_screenshot");
