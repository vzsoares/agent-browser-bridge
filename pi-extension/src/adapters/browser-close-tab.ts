/**
 * browser_close_tab adapter — wires the CloseTabUseCase to pi's defineTool.
 *
 * Defines the TypeBox parameter schema, delegates execution to the
 * application-layer use case via the infrastructure BridgeTransport, and
 * formats the result as pi-compatible text content blocks.
 *
 * @module adapters/browser-close-tab
 */

import {
	type AgentToolResult,
	defineTool,
} from "@mariozechner/pi-coding-agent";
import type { ErrorResponse } from "@pi-browser-bridge/protocol";
import { type Static, Type } from "typebox";
import { executeCloseTabUseCase } from "../application/close-tab-usecase.js";
import type { CloseTabResult } from "../application/types.js";
import { createBridgeTransport } from "../infrastructure/ws-transport.js";

// ── TypeBox Schema ────────────────────────────────────────────────────────

export const CloseTabSchema = Type.Object({
	tabId: Type.Integer(),
});

export type CloseTabParams = Static<typeof CloseTabSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────

function textBlock(text: string) {
	return { type: "text" as const, text };
}

function formatError(err: ErrorResponse): string {
	const lines = [`Close tab failed: ${err.message}`];
	if (err.code === "TAB_NOT_FOUND") {
		lines.push(
			"The tab may have already been closed. Use browser_list_tabs to find current open tabs.",
		);
	}
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
	params: CloseTabParams,
	_signal: AbortSignal | undefined,
	_onUpdate: unknown,
	_ctx: unknown,
): Promise<AgentToolResult<undefined>> {
	const transport = createBridgeTransport();
	const result = await executeCloseTabUseCase(transport, params);

	if (!result.success) {
		return {
			content: [textBlock(formatError(result.error))],
			details: undefined,
		};
	}

	const _data = result.data as CloseTabResult;
	return {
		content: [textBlock(`Tab ${params.tabId} has been closed.`)],
		details: undefined,
	};
}

// ── Tool Definition ───────────────────────────────────────────────────────

export const browserCloseTabTool = defineTool({
	name: "browser_close_tab",
	label: "Browser Close Tab",
	description:
		"Close a browser tab by its ID. Returns confirmation when the tab is closed. " +
		"Returns TAB_NOT_FOUND if the tab doesn't exist. Use browser_list_tabs to find tab IDs.",
	parameters: CloseTabSchema,
	execute,
});
