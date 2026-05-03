/**
 * WaitForTextUseCase — wait for specific text to appear on the page.
 *
 * Sends a waitForText request through the {@link BridgeTransport}
 * and returns timing metadata as a discriminated union. No infrastructure
 * concerns.
 *
 * @module application/wait-for-text-usecase
 */

import type { BridgeTransport } from "../domain/ports.js";
import type { ValidatedWaitForTextParams } from "../domain/schemas.js";
import { sendRequest } from "./send-request.js";
import { handleResponse } from "./handle-response.js";
import type { WaitForTextResult, UseCaseResult } from "./types.js";

/**
 * Wait for specific case-sensitive text content to appear on the page.
 *
 * Optionally scoped to a CSS selector. The Chrome extension polls the
 * page text every 100ms until the text is found or the timeout expires.
 *
 * @param transport — Dependency-injected bridge transport.
 * @param params — Validated wait parameters (from {@link WaitForTextSchema}).
 * @returns A discriminated union with timing info on success,
 *   or a structured protocol error on failure.
 */
export async function executeWaitForTextUseCase(
  transport: BridgeTransport,
  params: ValidatedWaitForTextParams,
): Promise<UseCaseResult<WaitForTextResult>> {
  const response = await sendRequest(transport, "waitForText", {
    text: params.text,
    scope: params.scope,
    timeout: params.timeout,
  });
  if (!response.success) return response;

  return handleResponse<WaitForTextResult>(response.data);
}
