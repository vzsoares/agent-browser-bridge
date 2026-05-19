/**
 * browser_wait_for_element MCP adapter.
 *
 * @module adapters/browser-wait-for-element
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { executeWaitForElementUseCase } from "../application/wait-for-element-usecase.js";
import {
	type ValidatedWaitForElementParams,
	WaitForElementSchema,
} from "../domain/schemas.js";
import { createBridgeTransport } from "../infrastructure/ws-transport.js";
import { errorResult, formatBridgeError, textResult } from "./helpers.js";

export { WaitForElementSchema } from "../domain/schemas.js";

export async function executeWaitForElement(
	params: ValidatedWaitForElementParams,
): Promise<CallToolResult> {
	const transport = createBridgeTransport();
	const result = await executeWaitForElementUseCase(transport, params);

	if (!result.success) {
		const extra: string[] = [];
		if (result.error.code === "TIMEOUT") {
			extra.push(
				`Element "${params.selector}" did not appear within ${params.timeout}ms.`,
			);
		}
		if (result.error.code === "BROWSER_NOT_CONNECTED") {
			extra.push(
				"No browser extension is connected. Make sure the Agent Browser Bridge extension is installed and active.",
			);
		}
		return errorResult(
			formatBridgeError("WaitForElement", result.error, extra),
		);
	}

	const { selector, elapsedMs, tagName } = result.data;
	return textResult(
		`Element "${selector}" appeared after ${elapsedMs}ms (tag: <${tagName.toLowerCase()}>).`,
	);
}

export const browserWaitForElementTool = {
	name: "browser_wait_for_element",
	description:
		"Wait for a CSS selector to match an element in the page. Resolves with timing info once the element appears.",
	inputSchema: WaitForElementSchema.shape,
	execute: executeWaitForElement,
} as const;
