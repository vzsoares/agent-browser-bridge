/**
 * browser_type MCP adapter.
 *
 * @module adapters/browser-type
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { executeTypeUseCase } from "../application/type-usecase.js";
import { TypeSchema, type ValidatedTypeParams } from "../domain/schemas.js";
import { createBridgeTransport } from "../infrastructure/ws-transport.js";
import { errorResult, formatBridgeError, textResult } from "./helpers.js";

export { TypeSchema } from "../domain/schemas.js";

export async function executeType(
	params: ValidatedTypeParams,
): Promise<CallToolResult> {
	const transport = createBridgeTransport();
	const result = await executeTypeUseCase(transport, params);

	if (!result.success) {
		const extra: string[] = [];
		if (result.error.code === "ELEMENT_NOT_FOUND") {
			extra.push(
				"The element was not found on the page. Check the selector and try again.",
			);
		}
		if (result.error.code === "ELEMENT_NOT_TYPABLE") {
			extra.push(
				"The element is not an input, textarea, or contenteditable element.",
			);
		}
		if (result.error.code === "BROWSER_NOT_CONNECTED") {
			extra.push(
				"No browser extension is connected. Make sure the Agent Browser Bridge extension is installed and active.",
			);
		}
		return errorResult(formatBridgeError("Type", result.error, extra));
	}

	const data = result.data;
	const lines = [
		`Typed into "${data.selector}"`,
		`Resulting value: "${data.value}"`,
	];
	if (data.suggestions) lines.push(data.suggestions);
	return textResult(lines.join("\n"));
}

export const browserTypeTool = {
	name: "browser_type",
	description:
		"Type text into an input, textarea, or contenteditable element in the browser. Optionally clear the existing value first and/or press Enter to submit afterwards.",
	inputSchema: TypeSchema.shape,
	execute: executeType,
} as const;
