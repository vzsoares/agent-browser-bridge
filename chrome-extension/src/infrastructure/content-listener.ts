/**
 * Content script message listener.
 *
 * Registers a `chrome.runtime.onMessage` listener that:
 * 1. Responds to `ping` and `heartbeat` health checks.
 * 2. Dispatches action requests to the application layer via the
 *    configured `dispatch` function.
 * 3. Performs a defence-in-depth domain allowlist check.
 *
 * Infrastructure layer — imports from domain/, application/,
 * and infrastructure/ (chrome-storage).
 *
 * @module infrastructure/content-listener
 */

import type {
	ErrorCode,
	ErrorResponse,
	Response,
} from "@pi-browser-bridge/protocol";

// ── Types ──────────────────────────────────────────────────────────────

/** Logger interface compatible with @pi-browser-bridge/logger. */
interface Logger {
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
}

/** Dispatch function signature (matches application/dispatcher). */
type DispatchFn = (action: string, params: unknown) => Promise<unknown>;

/** Configuration for the content script listener. */
export interface ContentListenerConfig {
	/** Application-layer dispatch function. */
	dispatch: DispatchFn;
	/** Domain matching function (from domain layer). */
	matchDomain: (hostname: string, allowlist: string[]) => boolean;
	/** Read the current domain allowlist from storage. */
	getAllowlist: () => Promise<string[]>;
	/** Logger instance. */
	logger: Logger;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Build a structured error Response object. */
function errorResponse(
	id: string,
	code: ErrorCode,
	message: string,
	suggestion?: string,
): Response {
	return {
		id,
		error: { code, message, ...(suggestion ? { suggestion } : {}) },
	};
}

/**
 * Bridge a dispatcher result to a protocol Response.
 *
 * If the result looks like a protocol ErrorResponse (has `code` and
 * `message` at the top level without domain-specific discriminator
 * fields), it is wrapped in the `.error` channel. Otherwise it is
 * wrapped in the `.result` channel.
 */
function bridgeResult(id: string, result: unknown): Response {
	if (isProtocolError(result)) {
		return { id, error: result as ErrorResponse };
	}
	return { id, result };
}

/**
 * Heuristic: detect whether a handler result is a protocol-level error.
 *
 * ErrorResponse has `code: string` and `message: string` without the
 * discriminator fields used by domain result types (clicked, typed,
 * found, text, value, serialized).
 */
function isProtocolError(result: unknown): result is ErrorResponse {
	if (typeof result !== "object" || result === null) return false;
	const r = result as Record<string, unknown>;
	return (
		typeof r.code === "string" &&
		typeof r.message === "string" &&
		!("clicked" in r) &&
		!("typed" in r) &&
		!("found" in r) &&
		!("text" in r) &&
		!("value" in r) &&
		!("serialized" in r) &&
		!("status" in r)
	);
}

// ── Factory ────────────────────────────────────────────────────────────

/**
 * Create and register a `chrome.runtime.onMessage` listener for the
 * content script.
 *
 * Call once from the content script entry point. The listener handles
 * ping/heartbeat/action messages and dispatches actions through the
 * application layer.
 */
export function createContentListener(config: ContentListenerConfig): void {
	const { dispatch, matchDomain: matchDomainFn, getAllowlist, logger } = config;

	// ── Supported action names for validation ────────────────────────
	const validActions = new Set([
		"navigate",
		"click",
		"type",
		"read",
		"exec",
		"waitForElement",
		"waitForText",
	]);

	chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
		if (!message || typeof message !== "object") {
			return false;
		}

		const msg = message as Record<string, unknown>;

		// ── Ping (service-worker injection check) ──────────────────────
		if (msg.type === "ping") {
			logger.info("ping received");
			sendResponse({ type: "pong" });
			return false; // synchronous
		}

		// ── Heartbeat (explicit health check) ──────────────────────────
		if (msg.type === "heartbeat") {
			logger.info("heartbeat received");
			sendResponse({ status: "ok" });
			return false; // synchronous
		}

		// ── Action request ─────────────────────────────────────────────
		if ("id" in msg && "action" in msg) {
			const id = String(msg.id);
			const action = String(msg.action);
			const params = msg.params;

			logger.info(`action: ${action} (id=${id})`);

			// Validate action name.
			if (!validActions.has(action)) {
				sendResponse(
					errorResponse(
						id,
						"UNKNOWN_ACTION",
						`Unknown action: "${action}"`,
						`Supported actions: ${[...validActions].join(", ")}`,
					),
				);
				return false;
			}

			// Async pipeline — keep the port open (return true).
			(async () => {
				// ── Domain allowlist check ──────────────────────────────────
				try {
					const allowlist = await getAllowlist();
					const hostname = window.location.hostname;
					if (hostname && !matchDomainFn(hostname, allowlist)) {
						try {
							sendResponse(
								errorResponse(
									id,
									"RESTRICTED_DOMAIN",
									`Domain "${hostname}" is not in the allowlist.`,
									`Add "${hostname}" to the extension popup's domain allowlist, or set it to "*" to allow all domains.`,
								),
							);
						} catch {
							// Port already closed.
						}
						return;
					}
				} catch {
					// Storage unavailable — fail open.
				}

				// ── Dispatch to application layer ──────────────────────────
				try {
					const result = await dispatch(action, params);
					try {
						sendResponse(bridgeResult(id, result));
					} catch {
						logger.warn("Failed to send response (port already closed)");
					}
				} catch (err: unknown) {
					const rawMessage = err instanceof Error ? err.message : String(err);
					logger.error(`Dispatch failed for "${action}":`, rawMessage);

					let code: ErrorCode = "UNKNOWN_ACTION";
					const lower = rawMessage.toLowerCase();
					if (lower.includes("timeout") || lower.includes("timed out")) {
						code = "TIMEOUT";
					} else if (
						lower.includes("not found") ||
						lower.includes("selector")
					) {
						code = "ELEMENT_NOT_FOUND";
					} else if (
						lower.includes("interactable") ||
						lower.includes("disabled") ||
						lower.includes("hidden")
					) {
						code = "ELEMENT_NOT_INTERACTABLE";
					}

					try {
						sendResponse(
							errorResponse(
								id,
								code,
								`Handler for "${action}" failed: ${rawMessage}`,
								"This is an unexpected error. Check the browser console for details.",
							),
						);
					} catch {
						// Port already closed.
					}
				}
			})();

			return true; // will call sendResponse asynchronously
		}

		// Unknown message shape — do not respond.
		return false;
	});
}
