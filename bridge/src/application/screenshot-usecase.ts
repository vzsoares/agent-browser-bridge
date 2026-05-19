/**
 * ScreenshotUseCase — capture a screenshot of the current browser tab.
 *
 * Sends a screenshot request through the {@link BridgeTransport} and
 * returns the base64-encoded image data as a discriminated union.
 * No infrastructure concerns.
 *
 * @module application/screenshot-usecase
 */

import type { BridgeTransport } from "../domain/ports.js";
import type { ValidatedScreenshotParams } from "../domain/schemas.js";
import { handleResponse } from "./handle-response.js";
import { sendRequest } from "./send-request.js";
import type { ScreenshotResult, UseCaseResult } from "./types.js";

/**
 * Capture a screenshot of the active browser tab.
 *
 * Supports PNG and JPEG output with configurable quality. Full-page
 * capture is currently viewport-only (v1 limitation).
 *
 * @param transport — Dependency-injected bridge transport.
 * @param params — Validated screenshot parameters (from {@link ScreenshotSchema}).
 * @returns A discriminated union with base64-encoded image data on success,
 *   or a structured protocol error on failure.
 */
export async function executeScreenshotUseCase(
	transport: BridgeTransport,
	params: ValidatedScreenshotParams,
): Promise<UseCaseResult<ScreenshotResult>> {
	const response = await sendRequest(transport, "screenshot", {
		tabId: params.tabId,
		format: params.format,
		quality: params.quality,
		fullPage: params.fullPage,
	});
	if (!response.success) return response;

	return handleResponse<ScreenshotResult>(response.data);
}
