/**
 * CreateTabUseCase — create a new browser tab.
 *
 * Delegates the tab creation to the {@link BridgeTransport}.
 * Returns a discriminated union so callers never encounter thrown errors.
 *
 * Pure application logic — zero infrastructure concerns.
 *
 * @module application/create-tab-usecase
 */

import type { BridgeTransport } from "../domain/ports.js";
import type { ValidatedCreateTabParams } from "../domain/schemas.js";
import { handleResponse } from "./handle-response.js";
import { sendRequest } from "./send-request.js";
import type { CreateTabResult, UseCaseResult } from "./types.js";

/**
 * Create a new browser tab, optionally with a URL and active state.
 *
 * @param transport — Dependency-injected bridge transport.
 * @param params — Validated create-tab parameters (from {@link CreateTabSchema}).
 * @returns A discriminated union with tabId, url, and title on success,
 *   or a structured protocol error on failure.
 */
export async function executeCreateTabUseCase(
	transport: BridgeTransport,
	params: ValidatedCreateTabParams,
): Promise<UseCaseResult<CreateTabResult>> {
	// ── Build and send request ────────────────────────────────────────
	const response = await sendRequest(transport, "createTab", {
		url: params.url,
		active: params.active,
	});
	if (!response.success) return response;

	// ── Extract result ────────────────────────────────────────────────
	return handleResponse<CreateTabResult>(response.data);
}
