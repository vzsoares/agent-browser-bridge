/**
 * browser_list_tabs adapter — wires the ListTabsUseCase to pi's defineTool.
 *
 * Defines the TypeBox parameter schema, delegates execution to the
 * application-layer use case via the infrastructure BridgeTransport, and
 * formats the result as pi-compatible text content blocks.
 *
 * @module adapters/browser-list-tabs
 */

import {
	type AgentToolResult,
	defineTool,
} from "@mariozechner/pi-coding-agent";
import type { ErrorResponse } from "@pi-browser-bridge/protocol";
import { type Static, Type } from "typebox";
import { executeListTabsUseCase } from "../application/list-tabs-usecase.js";
import type { ListTabsResult } from "../application/types.js";
import type { ValidatedListTabsParams } from "../domain/schemas.js";
import { createBridgeTransport } from "../infrastructure/ws-transport.js";

// ── TypeBox Schema ────────────────────────────────────────────────────────

export const ListTabsSchema = Type.Object({
	urlPattern: Type.Optional(Type.String()),
	currentWindowOnly: Type.Optional(Type.Boolean()),
});

export type ListTabsParams = Static<typeof ListTabsSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────

function textBlock(text: string) {
	return { type: "text" as const, text };
}

function formatError(err: ErrorResponse): string {
	const lines = [`List tabs failed: ${err.message}`];
	if (err.code === "BROWSER_NOT_CONNECTED") {
		lines.push(
			"No browser extension is connected. Make sure the Pi Browser Bridge extension is installed and active.",
		);
	}
	if (err.suggestion) lines.push(err.suggestion);
	return lines.join("\n");
}

// ── Execute ───────────────────────────────────────────────────────────────

async function execute(
	_toolCallId: string,
	params: ListTabsParams,
	_signal: AbortSignal | undefined,
	_onUpdate: unknown,
	_ctx: unknown,
): Promise<AgentToolResult<undefined>> {
	const transport = createBridgeTransport();
	const result = await executeListTabsUseCase(
		transport,
		params as unknown as ValidatedListTabsParams,
	);

	if (!result.success) {
		return {
			content: [textBlock(formatError(result.error))],
			details: undefined,
		};
	}

	const data = result.data as ListTabsResult;

	if (data.tabs.length === 0) {
		return {
			content: [textBlock("No tabs found matching the filter criteria.")],
			details: undefined,
		};
	}

	const lines = data.tabs.map((tab) => {
		const activeIndicator = tab.active ? " ★" : "";
		return `[${tab.tabId}] ${tab.title || "(no title)"} — ${tab.url}${activeIndicator}`;
	});

	const header = `Found ${data.tabs.length} tab(s):`;
	return {
		content: [textBlock([header, ...lines].join("\n"))],
		details: undefined,
	};
}

// ── Tool Definition ───────────────────────────────────────────────────────

export const browserListTabsTool = defineTool({
	name: "browser_list_tabs",
	label: "Browser List Tabs",
	description:
		"List open browser tabs. Optionally filter by URL or title substring via urlPattern, " +
		"and limit to the current window via currentWindowOnly (default true). " +
		"Returns an array of tab objects with tabId, url, title, and active status. " +
		"Use this to find tab IDs for targeting other browser tools.",
	parameters: ListTabsSchema,
	execute,
});
