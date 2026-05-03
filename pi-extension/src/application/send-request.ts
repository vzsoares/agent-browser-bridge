/**
 * sendRequest — orchestration utility for sending browser requests.
 *
 * Constructs a protocol {@link Request} with a unique correlation id
 * and delegates to the {@link BridgeTransport}. Transport-level errors
 * (connection loss, timeout) are caught and returned as
 * {@link UseCaseError} rather than thrown.
 *
 * @module application/send-request
 */

import type { Action, ErrorResponse, Request, Response } from "@pi-browser-bridge/protocol";
import type { BridgeTransport } from "../domain/ports.js";
import type { UseCaseResult } from "./types.js";

/**
 * Send a request to the browser extension through the given transport.
 *
 * Generates a unique request id and delegates sending to the transport.
 * Catches transport-level rejections (e.g. `BROWSER_NOT_CONNECTED`,
 * `TIMEOUT`) and converts them to the {@link UseCaseResult} discriminated
 * union so callers never have to deal with thrown errors.
 *
 * @typeParam A — Concrete action literal (e.g. `"navigate"`, `"click"`).
 * @param transport — The bridge transport (dependency-injected).
 * @param action — Which browser-automation action to perform.
 * @param params — Action-specific parameters (type-safe).
 * @returns A discriminated union. Check `.success` before accessing `.data`.
 */
export async function sendRequest<A extends Action>(
  transport: BridgeTransport,
  action: A,
  params: Request<A>["params"],
): Promise<UseCaseResult<Response<A>>> {
  const request: Request<A> = {
    id: crypto.randomUUID(),
    action,
    params,
  };

  try {
    const response = await transport.send(request);
    return { success: true, data: response };
  } catch (err) {
    // Transport errors are already ErrorResponse objects (by contract
    // of BridgeTransport.send). Defensively handle non-ErrorResponse
    // throwables too.
    const errorResponse = err as ErrorResponse;
    return {
      success: false,
      error: {
        code: errorResponse.code ?? "BROWSER_NOT_CONNECTED",
        message: errorResponse.message ?? String(err),
        suggestion: errorResponse.suggestion,
      },
    };
  }
}
