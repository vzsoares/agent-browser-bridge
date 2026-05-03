/**
 * ReadUseCase — read visible text content from the browser tab.
 *
 * Sends a read request through the {@link BridgeTransport} and returns
 * the extracted page text as a discriminated union. No infrastructure
 * concerns.
 *
 * @module application/read-usecase
 */

import type { BridgeTransport } from "../domain/ports.js";
import type { ValidatedReadParams } from "../domain/schemas.js";
import { sendRequest } from "./send-request.js";
import { handleResponse } from "./handle-response.js";
import type { ReadResult, UseCaseResult } from "./types.js";

/**
 * Read the visible text content of the active browser tab.
 *
 * Optionally scoped to a CSS selector. Long pages are truncated
 * to `maxLength` characters with a truncation flag.
 *
 * @param transport — Dependency-injected bridge transport.
 * @param params — Validated read parameters (from {@link ReadSchema}).
 * @returns A discriminated union with the extracted text on success,
 *   or a structured protocol error on failure.
 */
export async function executeReadUseCase(
  transport: BridgeTransport,
  params: ValidatedReadParams,
): Promise<UseCaseResult<ReadResult>> {
  const response = await sendRequest(transport, "read", {
    selector: params.selector,
    maxLength: params.maxLength,
  });
  if (!response.success) return response;

  return handleResponse<ReadResult>(response.data);
}
