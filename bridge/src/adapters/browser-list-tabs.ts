/**
 * browser_list_tabs MCP adapter.
 *
 * @module adapters/browser-list-tabs
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { executeListTabsUseCase } from "../application/list-tabs-usecase.js";
import {
	ListTabsSchema,
	type ValidatedListTabsParams,
} from "../domain/schemas.js";
import { createBridgeTransport } from "../infrastructure/ws-transport.js";
import { errorResult, formatBridgeError, textResult } from "./helpers.js";

export { ListTabsSchema } from "../domain/schemas.js";

export async function executeListTabs(
	params: ValidatedListTabsParams,
): Promise<CallToolResult> {
	const transport = createBridgeTransport();
	const result = await executeListTabsUseCase(transport, params);

	if (!result.success) {
		const extra: string[] = [];
		if (result.error.code === "BROWSER_NOT_CONNECTED") {
			extra.push(
				"No browser extension is connected. Make sure the Agent Browser Bridge extension is installed and active.",
			);
		}
		return errorResult(formatBridgeError("ListTabs", result.error, extra));
	}

	const { tabs } = result.data;
	if (tabs.length === 0) return textResult("No matching tabs.");

	const lines = tabs.map(
		(t) =>
			`  • [${t.tabId}]${t.active ? " (active)" : ""} ${t.title || "(no title)"} — ${t.url}`,
	);
	return textResult(`Open tabs (${tabs.length}):\n${lines.join("\n")}`);
}

export const browserListTabsTool = {
	name: "browser_list_tabs",
	description:
		"List browser tabs, optionally filtered by URL or title substring. By default only returns tabs from the current window.",
	inputSchema: ListTabsSchema.shape,
	execute: executeListTabs,
} as const;
