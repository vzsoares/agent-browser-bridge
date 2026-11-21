/**
 * browser_screenshot MCP adapter.
 *
 * @module adapters/browser-screenshot
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { executeScreenshotUseCase } from "../application/screenshot-usecase.js";
import {
	ScreenshotSchema,
	type ValidatedScreenshotParams,
} from "../domain/schemas.js";
import { createBridgeTransport } from "../infrastructure/ws-transport.js";
import {
	errorResult,
	formatBridgeError,
	type ImageBlock,
	imageBlock,
	type TextBlock,
	textBlock,
} from "./helpers.js";

export { ScreenshotSchema } from "../domain/schemas.js";

export async function executeScreenshot(
	params: ValidatedScreenshotParams,
): Promise<CallToolResult> {
	const transport = createBridgeTransport();
	const result = await executeScreenshotUseCase(transport, params);

	if (!result.success) {
		const extra: string[] = [];
		if (result.error.code === "RESTRICTED_URL") {
			extra.push(
				"Cannot capture screenshots of chrome://, edge://, or other restricted pages.",
			);
		}
		if (result.error.code === "TIMEOUT") {
			extra.push(
				"The screenshot timed out. The page may be taking too long to render.",
			);
		}
		if (result.error.code === "BROWSER_NOT_CONNECTED") {
			extra.push(
				"No browser extension is connected. Make sure the Agent Browser Bridge extension is installed and active.",
			);
		}
		return errorResult(formatBridgeError("Screenshot", result.error, extra));
	}

	const data = result.data;
	if (!data.data) return errorResult("Screenshot returned no image data.");

	const format = data.format ?? params.format;
	const content: (TextBlock | ImageBlock)[] = [imageBlock(data.data, format)];
	if (data.warning) content.push(textBlock(`⚠️ ${data.warning}`));
	return { content };
}

export const browserScreenshotTool = {
	name: "browser_screenshot",
	description:
		"Capture a screenshot of a tab in the user's real, logged-in Chrome. Returns a base64-encoded image in PNG or JPEG format. Captures the active tab by default. With tabId, the tab is briefly brought to the front for the capture and the previously active tab is restored afterwards.",
	inputSchema: ScreenshotSchema.shape,
	execute: executeScreenshot,
} as const;
