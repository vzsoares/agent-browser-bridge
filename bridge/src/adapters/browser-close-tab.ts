/**
 * browser_close_tab MCP adapter.
 *
 * @module adapters/browser-close-tab
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { executeCloseTabUseCase } from "../application/close-tab-usecase.js";
import {
	CloseTabSchema,
	type ValidatedCloseTabParams,
} from "../domain/schemas.js";
import { createBridgeTransport } from "../infrastructure/ws-transport.js";
import { errorResult, formatBridgeError, textResult } from "./helpers.js";

export { CloseTabSchema } from "../domain/schemas.js";

export async function executeCloseTab(
	params: ValidatedCloseTabParams,
): Promise<CallToolResult> {
	const transport = createBridgeTransport();
	const result = await executeCloseTabUseCase(transport, params);

	if (!result.success) {
		const extra: string[] = [];
		if (result.error.code === "TAB_NOT_FOUND") {
			extra.push(
				`No tab with id ${params.tabId}. Use browser_list_tabs to find a valid tab id.`,
			);
		}
		if (result.error.code === "BROWSER_NOT_CONNECTED") {
			extra.push(
				"No browser extension is connected. Make sure the Agent Browser Bridge extension is installed and active.",
			);
		}
		return errorResult(formatBridgeError("CloseTab", result.error, extra));
	}

	return textResult(`Closed tab ${params.tabId}.`);
}

export const browserCloseTabTool = {
	name: "browser_close_tab",
	description: "Close a browser tab by id.",
	inputSchema: CloseTabSchema.shape,
	execute: executeCloseTab,
} as const;
