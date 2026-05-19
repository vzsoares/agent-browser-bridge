/**
 * Domain error types and factory functions for the agent-browser-bridge.
 *
 * This module references protocol error codes and provides classification
 * helpers and factory functions. Zero dependencies on infrastructure
 * packages (Hono, ws, pi SDK).
 *
 * @module domain/errors
 */

import type { ErrorCode, ErrorResponse } from "@agent-browser-bridge/protocol";

// ── Re-exports ────────────────────────────────────────────────────────────

export type { ErrorCode, ErrorResponse };

// ── Error classification ──────────────────────────────────────────────────

/** Error categories used for decision-making (retry, surface to user, etc.). */
export type ErrorCategory =
	| "timeout"
	| "not_connected"
	| "validation"
	| "element"
	| "url_blocked"
	| "unknown";

/**
 * Map an {@link ErrorCode} to a broad category for programmatic handling.
 */
export function categorizeErrorCode(code: ErrorCode): ErrorCategory {
	switch (code) {
		case "TIMEOUT":
			return "timeout";
		case "BROWSER_NOT_CONNECTED":
		case "CONNECTION_RESET":
			return "not_connected";
		case "INVALID_URL":
		case "UNKNOWN_ACTION":
			return "validation";
		case "ELEMENT_NOT_FOUND":
		case "ELEMENT_NOT_INTERACTABLE":
		case "ELEMENT_NOT_TYPABLE":
			return "element";
		case "RESTRICTED_URL":
		case "RESTRICTED_DOMAIN":
			return "url_blocked";
		default:
			return "unknown";
	}
}

/** Whether the error code is retryable (transient failures). */
export function isRetryable(code: ErrorCode): boolean {
	return code === "TIMEOUT" || code === "CONNECTION_RESET";
}

// ── Error factory functions ───────────────────────────────────────────────

/**
 * Create a timeout error response for a given request id.
 */
export function createTimeoutError(
	requestId: string,
	timeoutMs: number,
): ErrorResponse {
	return {
		code: "TIMEOUT",
		message: `Request ${requestId} timed out after ${timeoutMs / 1000}s`,
		suggestion:
			"The browser may be unresponsive. Check the browser console for errors.",
	};
}

/**
 * Create a "no browser connected" error response.
 */
export function createNotConnectedError(): ErrorResponse {
	return {
		code: "BROWSER_NOT_CONNECTED",
		message: "No browser extension is connected to the WebSocket server.",
		suggestion:
			"Make sure the Agent Browser Bridge Chrome extension is installed and running.",
	};
}

/**
 * Create a "send failed" error response (WebSocket write error).
 */
export function createSendFailedError(): ErrorResponse {
	return {
		code: "BROWSER_NOT_CONNECTED",
		message: "Failed to send message to the browser extension.",
		suggestion:
			"The WebSocket connection may have been closed. Try restarting the extension.",
	};
}

/**
 * Create a "lost owner connection" error response (client mode).
 */
export function createOwnerNotConnectedError(): ErrorResponse {
	return {
		code: "BROWSER_NOT_CONNECTED",
		message:
			"Lost connection to the owner pi instance that runs the browser bridge server.",
		suggestion:
			"The first pi instance may have shut down. Restart pi instances in order.",
	};
}

/**
 * Create an "owner unreachable" error response (client mode).
 */
export function createOwnerUnreachableError(): ErrorResponse {
	return {
		code: "BROWSER_NOT_CONNECTED",
		message: "Could not reach the browser bridge server.",
		suggestion:
			"Make sure at least one pi instance is running with the browser bridge extension loaded.",
	};
}
