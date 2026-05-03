/**
 * ExecUseCase — execute arbitrary JavaScript in the page context.
 *
 * Sends an exec request through the {@link BridgeTransport} and returns
 * the serialized result as a discriminated union. No infrastructure
 * concerns.
 *
 * @module application/exec-usecase
 */

import type { BridgeTransport } from "../domain/ports.js";
import type { ValidatedExecParams } from "../domain/schemas.js";
import { sendRequest } from "./send-request.js";
import { handleResponse } from "./handle-response.js";
import type { ExecResult, UseCaseResult } from "./types.js";

/**
 * Execute arbitrary JavaScript code in the active browser tab's page context.
 *
 * Async code (Promises) is automatically awaited. The return value is
 * serialised for safe display (capped at 10 000 characters).
 *
 * @param transport — Dependency-injected bridge transport.
 * @param params — Validated exec parameters (from {@link ExecSchema}).
 * @returns A discriminated union with the serialised output on success,
 *   or a structured protocol error on failure.
 */
export async function executeExecUseCase(
  transport: BridgeTransport,
  params: ValidatedExecParams,
): Promise<UseCaseResult<ExecResult>> {
  const response = await sendRequest(transport, "exec", {
    code: params.code,
  });
  if (!response.success) return response;

  return handleResponse<ExecResult>(response.data);
}
