/**
 * handleResponse — orchestration utility for processing browser responses.
 *
 * Inspects the protocol {@link Response} and converts it into the
 * application-level {@link UseCaseResult} discriminated union. When the
 * response carries an `error` field the result is a failure; otherwise
 * the raw payload is extracted and wrapped as a success.
 *
 * @module application/handle-response
 */

import type { Response } from "@agent-browser-bridge/protocol";
import type { UseCaseResult } from "./types.js";

/**
 * Process a protocol {@link Response} into a typed use-case result.
 *
 * If the response contains an {@link ErrorResponse} (`.error` is set),
 * a failure result is returned. Otherwise the `.result` payload is
 * returned as the success data.
 *
 * No exceptions are thrown — errors are always returned as part of
 * the discriminated union.
 *
 * @typeParam T — The expected type of the result payload.
 * @param response — A protocol response (from {@link sendRequest} or
 *   any other source that produces protocol-compliant responses).
 * @returns A discriminated union. Check `.success` to branch.
 */
export function handleResponse<T>(response: Response): UseCaseResult<T> {
	if (response.error) {
		return { success: false, error: response.error };
	}
	return { success: true, data: response.result as T };
}
