/**
 * ClickUseCase — click an element in the browser tab.
 *
 * Sends a click request through the {@link BridgeTransport} and returns
 * the outcome as a discriminated union. No infrastructure concerns.
 *
 * @module application/click-usecase
 */

import type { BridgeTransport } from "../domain/ports.js";
import type { ValidatedClickParams } from "../domain/schemas.js";
import { sendRequest } from "./send-request.js";
import { handleResponse } from "./handle-response.js";
import type { ClickResult, UseCaseResult } from "./types.js";

/**
 * Click an element matching a CSS selector in the active browser tab.
 *
 * @param transport — Dependency-injected bridge transport.
 * @param params — Validated click parameters (from {@link ClickSchema}).
 * @returns A discriminated union with click metadata on success,
 *   or a structured protocol error on failure.
 */
export async function executeClickUseCase(
  transport: BridgeTransport,
  params: ValidatedClickParams,
): Promise<UseCaseResult<ClickResult>> {
  const response = await sendRequest(transport, "click", {
    tabId: params.tabId,
    selector: params.selector,
    text: params.text,
    timeout: params.timeout,
  });
  if (!response.success) return response;

  return handleResponse<ClickResult>(response.data);
}
