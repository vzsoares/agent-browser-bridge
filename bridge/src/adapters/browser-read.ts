/**
 * browser_read MCP adapter.
 *
 * @module adapters/browser-read
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { executeReadUseCase } from "../application/read-usecase.js";
import { ReadSchema, type ValidatedReadParams } from "../domain/schemas.js";
import { createBridgeTransport } from "../infrastructure/ws-transport.js";
import { errorResult, formatBridgeError, textResult } from "./helpers.js";

export { ReadSchema } from "../domain/schemas.js";

export async function executeRead(
	params: ValidatedReadParams,
): Promise<CallToolResult> {
	const transport = createBridgeTransport();
	const result = await executeReadUseCase(transport, params);

	if (!result.success) {
		const extra: string[] = [];
		if (result.error.code === "ELEMENT_NOT_FOUND") {
			extra.push(
				"The selector did not match any element on the page. Check that the element exists and the CSS selector is correct.",
			);
		}
		if (result.error.code === "BROWSER_NOT_CONNECTED") {
			extra.push(
				"No browser extension is connected. Make sure the Agent Browser Bridge extension is installed and active.",
			);
		}
		if (result.error.code === "TIMEOUT") {
			extra.push(
				"The read operation timed out. The page may be too large or unresponsive.",
			);
		}
		return errorResult(formatBridgeError("Read", result.error, extra));
	}

	const data = result.data;
	if (typeof data.text !== "string") {
		return errorResult("Read returned no text content.");
	}

	let text = data.text;
	if (data.truncated) {
		const maxLen = params.maxLength.toLocaleString();
		const total = data.length.toLocaleString();
		text += `\n\n[truncated — ${total} chars total; showing first ${maxLen}]`;
	}
	return textResult(text);
}

export const browserReadTool = {
	name: "browser_read",
	description:
		"Read the text content of the browser tab. Optionally target a specific tab via tabId; when omitted, defaults to the active tab. Can scope to a CSS selector or read the entire page body.",
	inputSchema: ReadSchema.shape,
	execute: executeRead,
} as const;
