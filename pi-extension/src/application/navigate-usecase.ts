/**
 * NavigateUseCase — navigate the browser to a URL.
 *
 * Validates the target URL against format and security constraints
 * using domain-level primitives, then delegates the navigation to
 * the {@link BridgeTransport}. Returns a discriminated union so
 * callers never encounter thrown errors.
 *
 * Pure application logic — zero infrastructure concerns.
 *
 * @module application/navigate-usecase
 */

import type { BridgeTransport } from "../domain/ports.js";
import type { ValidatedNavigateParams } from "../domain/schemas.js";
import { validateUrl } from "../domain/allowlist.js";
import { sendRequest } from "./send-request.js";
import { handleResponse } from "./handle-response.js";
import type { NavigateResult, UseCaseResult } from "./types.js";

/**
 * Navigate the active browser tab to a URL.
 *
 * Performs domain-level URL validation (well-formedness, restricted
 * schemes) and proxies the navigation request through the transport.
 *
 * @param transport — Dependency-injected bridge transport.
 * @param params — Validated navigate parameters (from {@link NavigateSchema}).
 * @returns A discriminated union with the final URL and page title on success,
 *   or a structured protocol error on failure.
 */
export async function executeNavigateUseCase(
  transport: BridgeTransport,
  params: ValidatedNavigateParams,
): Promise<UseCaseResult<NavigateResult>> {
  // ── Domain validation: URL format and scheme restrictions ───────────
  const urlCheck = validateUrl(params.url);
  if (!urlCheck.valid) {
    return {
      success: false,
      error: {
        code: urlCheck.code,
        message: urlCheck.message,
        suggestion: urlCheck.suggestion,
      },
    };
  }

  // ── Build and send request ────────────────────────────────────────
  const response = await sendRequest(transport, "navigate", {
    url: params.url,
    waitUntil: params.waitUntil,
    timeout: params.timeout,
  });
  if (!response.success) return response;

  // ── Extract result ────────────────────────────────────────────────
  return handleResponse<NavigateResult>(response.data);
}
