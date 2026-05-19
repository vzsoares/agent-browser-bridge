/**
 * browser_exec MCP adapter.
 *
 * @module adapters/browser-exec
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { executeExecUseCase } from "../application/exec-usecase.js";
import { ExecSchema, type ValidatedExecParams } from "../domain/schemas.js";
import { createBridgeTransport } from "../infrastructure/ws-transport.js";
import { errorResult, formatBridgeError, textResult } from "./helpers.js";

export { ExecSchema } from "../domain/schemas.js";

export async function executeExec(
	params: ValidatedExecParams,
): Promise<CallToolResult> {
	const transport = createBridgeTransport();
	const result = await executeExecUseCase(transport, params);

	if (!result.success) {
		const extra: string[] = [];
		if (result.error.code === "BROWSER_NOT_CONNECTED") {
			extra.push(
				"No browser extension is connected. Make sure the Agent Browser Bridge extension is installed and active.",
			);
		}
		return errorResult(formatBridgeError("Exec", result.error, extra));
	}

	return textResult(result.data.serialized);
}

export const browserExecTool = {
	name: "browser_exec",
	description:
		"Execute arbitrary JavaScript in the page context and return its (serialized) result. Async values are awaited.",
	inputSchema: ExecSchema.shape,
	execute: executeExec,
} as const;
