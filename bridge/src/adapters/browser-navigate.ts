/**
 * browser_navigate MCP adapter.
 *
 * Wires the NavigateUseCase to an MCP tool registration. Uses the existing
 * Zod schema from the domain layer for input validation.
 *
 * @module adapters/browser-navigate
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { executeNavigateUseCase } from "../application/navigate-usecase.js";
import {
	NavigateSchema,
	type ValidatedNavigateParams,
} from "../domain/schemas.js";
import { createBridgeTransport } from "../infrastructure/ws-transport.js";
import { errorResult, formatBridgeError, textResult } from "./helpers.js";

export { NavigateSchema } from "../domain/schemas.js";

export async function executeNavigate(
	params: ValidatedNavigateParams,
): Promise<CallToolResult> {
	const transport = createBridgeTransport();
	const result = await executeNavigateUseCase(transport, params);

	if (!result.success) {
		const extra: string[] = [];
		if (result.error.code === "RESTRICTED_URL") {
			extra.push(
				"Cannot navigate to chrome://, edge://, or other restricted pages.",
			);
		}
		if (result.error.code === "TIMEOUT") {
			extra.push(
				`The page took longer than ${params.timeout}ms to load. Try increasing the timeout or check the URL.`,
			);
		}
		if (result.error.code === "BROWSER_NOT_CONNECTED") {
			extra.push(
				"No browser extension is connected. Make sure the Agent Browser Bridge extension is installed and active.",
			);
		}
		return errorResult(formatBridgeError("Navigate", result.error, extra));
	}

	const { url, title } = result.data;
	return textResult(
		`Navigated to: ${url}\nPage title: ${title || "(no title)"}`,
	);
}

export const browserNavigateTool = {
	name: "browser_navigate",
	description:
		"Navigate the browser to a URL. Optionally target a specific tab via tabId; when omitted, defaults to the active tab or creates a new tab. Supports waiting for page load, DOMContentLoaded, or network idle.",
	inputSchema: NavigateSchema.shape,
	execute: executeNavigate,
} as const;
