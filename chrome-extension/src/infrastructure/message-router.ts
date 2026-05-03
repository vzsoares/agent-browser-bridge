/**
 * WebSocket message routing.
 *
 * Parses incoming WebSocket messages, validates them against the protocol,
 * and routes them to the appropriate handler path:
 * - `navigate` and `screenshot` → handled in the service worker (Chrome APIs).
 * - All other actions → forwarded to the content script.
 *
 * Infrastructure layer — imports from domain/ (allowlist matching) and
 * chrome-tabs / chrome-storage (Chrome API wrappers).
 *
 * @module infrastructure/message-router
 */

import type { Request, Response } from "@pi-browser-bridge/protocol";

import { matchDomain } from "../domain/index.js";
import { getAllowlist } from "./chrome-storage.js";
import {
	forwardToContentScript,
	getActiveTabId,
	getActiveTabUrl,
} from "./chrome-tabs.js";
import type { WebSocketClient } from "./websocket-client.js";

// ── Types ──────────────────────────────────────────────────────────────

/** Logger interface compatible with @pi-browser-bridge/logger. */
interface Logger {
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
}

// ── Message parsing ────────────────────────────────────────────────────

/**
 * Parse and validate an incoming WebSocket message.
 * Returns a Request if valid, or an error Response to send back.
 */
function parseRequest(raw: string): Request | Response {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {
			id: "",
			error: { code: "UNKNOWN_ACTION", message: "Invalid JSON payload" },
		};
	}

	if (typeof parsed !== "object" || parsed === null) {
		return {
			id: "",
			error: {
				code: "UNKNOWN_ACTION",
				message: "Request must be a JSON object",
			},
		};
	}

	const obj = parsed as Record<string, unknown>;

	if (typeof obj.id !== "string" || obj.id.length === 0) {
		return {
			id: "",
			error: {
				code: "UNKNOWN_ACTION",
				message: "Missing or invalid 'id' field",
			},
		};
	}

	if (typeof obj.action !== "string") {
		return {
			id: obj.id,
			error: {
				code: "UNKNOWN_ACTION",
				message: "Missing or invalid 'action' field",
			},
		};
	}

	const validActions = [
		"navigate",
		"click",
		"type",
		"screenshot",
		"read",
		"exec",
		"waitForElement",
		"waitForText",
	];
	if (!(validActions as string[]).includes(obj.action)) {
		return {
			id: obj.id,
			error: {
				code: "UNKNOWN_ACTION",
				message: `Unknown action: "${obj.action}"`,
			},
		};
	}

	return obj as unknown as Request;
}

// ── Response serialization ─────────────────────────────────────────────

/** Serialize a Response for sending over WebSocket. */
function serializeResponse(resp: Response): string {
	try {
		return JSON.stringify(resp);
	} catch {
		return JSON.stringify({
			id: resp.id,
			error: {
				code: "UNKNOWN_ACTION",
				message: "Failed to serialize response",
			},
		});
	}
}

// ── Message handler factory ────────────────────────────────────────────

export interface MessageRouterOptions {
	/** Logger instance. */
	logger: Logger;
	/** WebSocket client for sending responses. */
	wsClient: WebSocketClient;
	/** Current enabled status (read/write — mutated by storage listener). */
	enabled: { current: boolean };
	/** Current active tab ID (read/write — mutated by tab listener). */
	activeTabId: { current: number | null };
	/** Service-worker-level navigate handler (needs chrome.tabs.update). */
	handleNavigate: (id: string, params: unknown) => Promise<Response>;
	/** Service-worker-level screenshot handler (needs chrome.tabs.captureVisibleTab). */
	handleScreenshot: (id: string, params: unknown) => Promise<Response>;
}

/**
 * Create a message handler for incoming WebSocket data.
 *
 * The returned function is suitable as the `onMessage` callback of
 * {@link WebSocketClient}.
 */
export function createMessageRouter(
	options: MessageRouterOptions,
): (raw: string) => Promise<void> {
	const {
		logger,
		wsClient,
		enabled,
		activeTabId,
		handleNavigate,
		handleScreenshot,
	} = options;

	async function handleIncomingMessage(raw: string): Promise<void> {
		// ── Respect the disabled flag ──────────────────────────────────────
		if (!enabled.current) {
			logger.info("Bridge is disabled — ignoring incoming message");
			let id = "";
			try {
				const m = JSON.parse(raw);
				if (m && typeof m === "object" && typeof m.id === "string") id = m.id;
			} catch {
				/* use empty id */
			}
			sendResponse({
				id,
				error: {
					code: "BROWSER_NOT_CONNECTED",
					message:
						"Bridge is disabled. Toggle 'Enable Bridge' in the extension popup to re-enable.",
				},
			});
			return;
		}

		logger.info(
			`Received: ${raw.length > 200 ? `${raw.slice(0, 200)}…` : raw}`,
		);

		const parsed = parseRequest(raw);

		// If parseRequest returned an error Response, send it back immediately.
		if ("error" in parsed && parsed.id !== undefined) {
			sendResponse(parsed as Response);
			return;
		}

		const request = parsed as Request;

		// ── Navigate: handle directly (content script destroyed on navigation) ─
		if (request.action === "navigate") {
			const resp = await handleNavigate(request.id, request.params);
			sendResponse(resp);
			return;
		}

		// ── Screenshot: handle directly (no content script needed) ──────────
		if (request.action === "screenshot") {
			const resp = await handleScreenshot(request.id, request.params);
			sendResponse(resp);
			return;
		}

		// ── Domain allowlist check ─────────────────────────────────────────
		const tabUrl = await getActiveTabUrl();
		if (tabUrl) {
			let hostname: string;
			try {
				hostname = new URL(tabUrl).hostname;
			} catch {
				hostname = "";
			}
			if (hostname) {
				const allowlist = await getAllowlist();
				if (!matchDomain(hostname, allowlist)) {
					sendResponse({
						id: request.id,
						error: {
							code: "RESTRICTED_DOMAIN",
							message: `Domain "${hostname}" is not in the allowlist.`,
							suggestion: `Add "${hostname}" to the extension popup's domain allowlist, or set it to "*" to allow all domains.`,
						},
					});
					return;
				}
			}
		}

		// ── All other actions: forward to content script ──────────────────
		if (activeTabId.current === null) {
			activeTabId.current = await getActiveTabId();
		}

		if (activeTabId.current === null) {
			sendResponse({
				id: request.id,
				error: {
					code: "BROWSER_NOT_CONNECTED",
					message: "No active tab available",
				},
			});
			return;
		}

		const resp = await forwardToContentScript(activeTabId.current, request);
		sendResponse(resp as Response);
	}

	function sendResponse(resp: Response): void {
		wsClient.send(serializeResponse(resp));
	}

	return handleIncomingMessage;
}
