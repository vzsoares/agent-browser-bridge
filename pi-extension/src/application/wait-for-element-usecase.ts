/**
 * WaitForElementUseCase — wait for an element to appear in the DOM.
 *
 * Sends a waitForElement request through the {@link BridgeTransport}
 * and returns timing metadata as a discriminated union. No infrastructure
 * concerns.
 *
 * @module application/wait-for-element-usecase
 */

import type { BridgeTransport } from "../domain/ports.js";
import type { ValidatedWaitForElementParams } from "../domain/schemas.js";
import { sendRequest } from "./send-request.js";
import { handleResponse } from "./handle-response.js";
import type { WaitForElementResult, UseCaseResult } from "./types.js";

/**
 * Wait for an element matching a CSS selector to appear in the DOM.
 *
 * The Chrome extension polls the DOM (using MutationObserver +
 * interval polling) until the element is found or the timeout expires.
 *
 * @param transport — Dependency-injected bridge transport.
 * @param params — Validated wait parameters (from {@link WaitForElementSchema}).
 * @returns A discriminated union with timing info and the element's tag
 *   name on success, or a structured protocol error on failure.
 */
export async function executeWaitForElementUseCase(
  transport: BridgeTransport,
  params: ValidatedWaitForElementParams,
): Promise<UseCaseResult<WaitForElementResult>> {
  const response = await sendRequest(transport, "waitForElement", {
    selector: params.selector,
    timeout: params.timeout,
  });
  if (!response.success) return response;

  return handleResponse<WaitForElementResult>(response.data);
}
