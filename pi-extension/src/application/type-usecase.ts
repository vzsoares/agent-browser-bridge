/**
 * TypeUseCase — type text into an input element.
 *
 * Sends a type request through the {@link BridgeTransport} and returns
 * the outcome as a discriminated union. No infrastructure concerns.
 *
 * @module application/type-usecase
 */

import type { BridgeTransport } from "../domain/ports.js";
import type { ValidatedTypeParams } from "../domain/schemas.js";
import { sendRequest } from "./send-request.js";
import { handleResponse } from "./handle-response.js";
import type { TypeResult, UseCaseResult } from "./types.js";

/**
 * Type text into an input element in the active browser tab.
 *
 * Optionally clears the field first and submits the surrounding form
 * after typing. Respects the element wait timeout.
 *
 * @param transport — Dependency-injected bridge transport.
 * @param params — Validated type parameters (from {@link TypeSchema}).
 * @returns A discriminated union with the typed value on success,
 *   or a structured protocol error on failure.
 */
export async function executeTypeUseCase(
  transport: BridgeTransport,
  params: ValidatedTypeParams,
): Promise<UseCaseResult<TypeResult>> {
  const response = await sendRequest(transport, "type", {
    selector: params.selector,
    text: params.text,
    clear: params.clear,
    submit: params.submit,
    timeout: params.timeout,
  });
  if (!response.success) return response;

  return handleResponse<TypeResult>(response.data);
}
