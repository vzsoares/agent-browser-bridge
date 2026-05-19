/**
 * Shared MCP adapter helpers — content-block builders and generic error
 * formatting.
 *
 * The MCP SDK accepts `{ content: [{ type: "text" | "image", ... }] }` from
 * tool handlers. These helpers centralize the block shape and the common
 * error-message scaffolding so each per-tool adapter stays small.
 *
 * @module adapters/helpers
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ErrorResponse } from "@agent-browser-bridge/protocol";

export type TextBlock = { type: "text"; text: string };
export type ImageBlock = {
	type: "image";
	data: string;
	mimeType: string;
};

export function textBlock(text: string): TextBlock {
	return { type: "text", text };
}

export function imageBlock(data: string, format: "png" | "jpeg"): ImageBlock {
	return {
		type: "image",
		data,
		mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
	};
}

/** Build an MCP error result with a single text block. */
export function errorResult(text: string): CallToolResult {
	return { content: [textBlock(text)], isError: true };
}

/** Build an MCP success result with a single text block. */
export function textResult(text: string): CallToolResult {
	return { content: [textBlock(text)] };
}

/**
 * Format an {@link ErrorResponse} from the bridge into a multi-line message
 * with the tool prefix, the underlying message, and any suggestion.
 *
 * Per-tool adapters pass `extraLines` to append code-specific guidance.
 */
export function formatBridgeError(
	toolLabel: string,
	err: ErrorResponse,
	extraLines: string[] = [],
): string {
	const lines = [`${toolLabel} failed: ${err.message}`, ...extraLines];
	if (err.suggestion) lines.push(err.suggestion);
	return lines.join("\n");
}
