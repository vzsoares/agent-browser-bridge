/**
 * browser_wait_for_text MCP adapter.
 *
 * @module adapters/browser-wait-for-text
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { executeWaitForTextUseCase } from "../application/wait-for-text-usecase.js";
import {
	type ValidatedWaitForTextParams,
	WaitForTextSchema,
} from "../domain/schemas.js";
import { createBridgeTransport } from "../infrastructure/ws-transport.js";
import { errorResult, formatBridgeError, textResult } from "./helpers.js";

export { WaitForTextSchema } from "../domain/schemas.js";

export async function executeWaitForText(
	params: ValidatedWaitForTextParams,
): Promise<CallToolResult> {
	const transport = createBridgeTransport();
	const result = await executeWaitForTextUseCase(transport, params);

	if (!result.success) {
		const extra: string[] = [];
		if (result.error.code === "TIMEOUT") {
			extra.push(
				`Text "${params.text}" did not appear within ${params.timeout}ms.`,
			);
		}
		if (result.error.code === "BROWSER_NOT_CONNECTED") {
			extra.push(
				"No browser extension is connected. Make sure the Agent Browser Bridge extension is installed and active.",
			);
		}
		return errorResult(formatBridgeError("WaitForText", result.error, extra));
	}

	const { text, elapsedMs } = result.data;
	return textResult(`Text "${text}" appeared after ${elapsedMs}ms.`);
}

export const browserWaitForTextTool = {
	name: "browser_wait_for_text",
	description:
		"Wait for a substring of text to appear on the page (optionally within a CSS scope).",
	inputSchema: WaitForTextSchema.shape,
	execute: executeWaitForText,
} as const;
