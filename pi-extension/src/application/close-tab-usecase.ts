/**
 * CloseTabUseCase — close a browser tab by its ID.
 *
 * Delegates the tab closing to the {@link BridgeTransport}.
 * Returns a discriminated union so callers never encounter thrown errors.
 *
 * Pure application logic — zero infrastructure concerns.
 *
 * @module application/close-tab-usecase
 */

import type { ValidatedCloseTabParams } from "../domain/schemas.js";
import type { BridgeTransport } from "../domain/ports.js";
import { sendRequest } from "./send-request.js";
import { handleResponse } from "./handle-response.js";
import type { CloseTabResult, UseCaseResult } from "./types.js";

/**
 * Close a browser tab by its ID.
 *
 * @param transport — Dependency-injected bridge transport.
 * @param params — Validated close-tab parameters (from {@link CloseTabSchema}).
 * @returns A discriminated union with confirmation on success,
 *   or a structured protocol error on failure.
 */
export async function executeCloseTabUseCase(
  transport: BridgeTransport,
  params: ValidatedCloseTabParams,
): Promise<UseCaseResult<CloseTabResult>> {
  // ── Build and send request ────────────────────────────────────────
  const response = await sendRequest(transport, "closeTab", {
    tabId: params.tabId,
  });
  if (!response.success) return response;

  // ── Extract result ────────────────────────────────────────────────
  return handleResponse<CloseTabResult>(response.data);
}
