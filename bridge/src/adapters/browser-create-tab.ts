/**
 * browser_create_tab MCP adapter.
 *
 * @module adapters/browser-create-tab
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { executeCreateTabUseCase } from "../application/create-tab-usecase.js";
import {
	CreateTabSchema,
	type ValidatedCreateTabParams,
} from "../domain/schemas.js";
import { createBridgeTransport } from "../infrastructure/ws-transport.js";
import { errorResult, formatBridgeError, textResult } from "./helpers.js";

export { CreateTabSchema } from "../domain/schemas.js";

export async function executeCreateTab(
	params: ValidatedCreateTabParams,
): Promise<CallToolResult> {
	const transport = createBridgeTransport();
	const result = await executeCreateTabUseCase(transport, params);

	if (!result.success) {
		const extra: string[] = [];
		if (result.error.code === "RESTRICTED_URL") {
			extra.push(
				"Cannot open chrome://, edge://, or other restricted pages in a new tab.",
			);
		}
		if (result.error.code === "BROWSER_NOT_CONNECTED") {
			extra.push(
				"No browser extension is connected. Make sure the Agent Browser Bridge extension is installed and active.",
			);
		}
		return errorResult(formatBridgeError("CreateTab", result.error, extra));
	}

	const { tabId, url, title } = result.data;
	return textResult(
		`Opened new tab ${tabId}\nURL: ${url}\nTitle: ${title || "(no title)"}`,
	);
}

export const browserCreateTabTool = {
	name: "browser_create_tab",
	description:
		"Create a new browser tab and (optionally) navigate it to a URL. Returns the new tab's id, url, and title.",
	inputSchema: CreateTabSchema.shape,
	execute: executeCreateTab,
} as const;
