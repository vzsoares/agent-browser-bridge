/**
 * browser_click MCP adapter.
 *
 * Wires the ClickUseCase to an MCP tool registration. Handles two failure
 * shapes from the content script: a top-level UseCaseError, and a
 * `{ clicked: false }` payload that arrives as a "success" with embedded
 * suggestions.
 *
 * @module adapters/browser-click
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { executeClickUseCase } from "../application/click-usecase.js";
import type { ClickResult } from "../application/types.js";
import { ClickSchema, type ValidatedClickParams } from "../domain/schemas.js";
import { createBridgeTransport } from "../infrastructure/ws-transport.js";
import { errorResult, formatBridgeError, textResult } from "./helpers.js";

export { ClickSchema } from "../domain/schemas.js";

interface ClickErrorData {
	clicked: false;
	code: string;
	message: string;
	suggestions?: string[];
}

export async function executeClick(
	params: ValidatedClickParams,
): Promise<CallToolResult> {
	const transport = createBridgeTransport();
	const result = await executeClickUseCase(transport, params);

	if (!result.success) {
		const extra: string[] = [];
		if (result.error.code === "ELEMENT_NOT_FOUND") {
			extra.push(
				"The element was not found on the page. Check the selector and try again.",
			);
		}
		if (result.error.code === "ELEMENT_NOT_INTERACTABLE") {
			extra.push(
				"The element exists but cannot be interacted with (hidden or disabled).",
			);
		}
		if (result.error.code === "TIMEOUT") {
			extra.push(
				`The click request timed out after ${params.timeout}ms. The element may have not appeared in time.`,
			);
		}
		if (result.error.code === "BROWSER_NOT_CONNECTED") {
			extra.push(
				"No browser extension is connected. Make sure the Agent Browser Bridge extension is installed and active.",
			);
		}
		return errorResult(formatBridgeError("Click", result.error, extra));
	}

	const data = result.data as ClickResult | ClickErrorData;

	if (!data.clicked) {
		const err = data as ClickErrorData;
		const lines = [`Click failed: ${err.message}`];
		if (err.code === "ELEMENT_NOT_FOUND" && err.suggestions?.length) {
			lines.push(
				"",
				`Elements matching selector "${params.selector}" on the page:`,
				...err.suggestions.map((s, i) => `  ${i + 1}. "${s}"`),
			);
		} else if (err.code === "ELEMENT_NOT_INTERACTABLE") {
			lines.push(
				"The element exists but is hidden or disabled and cannot be clicked.",
			);
		}
		return errorResult(lines.join("\n"));
	}

	const success = data as ClickResult;
	const lines = [
		`Clicked element "${success.selector}"`,
		`Element text: "${success.text}"`,
	];
	if (success.navigated) {
		lines.push(
			"Navigation occurred after click.",
			`New title: ${success.newTitle ?? "(unknown)"}`,
			`New URL: ${success.newUrl ?? "(unknown)"}`,
		);
	}
	return textResult(lines.join("\n"));
}

export const browserClickTool = {
	name: "browser_click",
	description:
		"Click an element in the browser tab identified by a CSS selector. Optionally target a specific tab via tabId; when omitted, defaults to the active tab. Optionally disambiguate by text content.",
	inputSchema: ClickSchema.shape,
	execute: executeClick,
} as const;
