/**
 * ListTabsUseCase — list open browser tabs with optional filtering.
 *
 * Delegates the tab listing to the {@link BridgeTransport}.
 * Returns a discriminated union so callers never encounter thrown errors.
 *
 * Pure application logic — zero infrastructure concerns.
 *
 * @module application/list-tabs-usecase
 */

import type { BridgeTransport } from "../domain/ports.js";
import type { ValidatedListTabsParams } from "../domain/schemas.js";
import { handleResponse } from "./handle-response.js";
import { sendRequest } from "./send-request.js";
import type { ListTabsResult, UseCaseResult } from "./types.js";

/**
 * List open browser tabs, optionally filtered by URL pattern and window.
 *
 * @param transport — Dependency-injected bridge transport.
 * @param params — Validated list-tabs parameters (from {@link ListTabsSchema}).
 * @returns A discriminated union with an array of tab descriptors on success,
 *   or a structured protocol error on failure.
 */
export async function executeListTabsUseCase(
	transport: BridgeTransport,
	params: ValidatedListTabsParams,
): Promise<UseCaseResult<ListTabsResult>> {
	// ── Build and send request ────────────────────────────────────────
	const response = await sendRequest(transport, "listTabs", {
		urlPattern: params.urlPattern,
		currentWindowOnly: params.currentWindowOnly,
	});
	if (!response.success) return response;

	// ── Extract result ────────────────────────────────────────────────
	return handleResponse<ListTabsResult>(response.data);
}
