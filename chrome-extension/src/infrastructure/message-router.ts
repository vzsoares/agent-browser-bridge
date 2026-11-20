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

import type { Request, Response } from "@agent-browser-bridge/protocol";

import { matchDomain } from "../domain/index.js";
import { appendActionLog, buildEntry } from "./action-log.js";
import { trackBusy } from "./chrome-runtime.js";
import { getAllowlist } from "./chrome-storage.js";
import {
	forwardToContentScript,
	getActiveTabId,
	getActiveTabUrl,
	getTab,
} from "./chrome-tabs.js";
import type { WebSocketClient } from "./websocket-client.js";

// ── Types ──────────────────────────────────────────────────────────────

/** Logger interface compatible with @agent-browser-bridge/logger. */
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
		"createTab",
		"listTabs",
		"closeTab",
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

function numberField(obj: unknown, key: string): number | null {
	if (typeof obj !== "object" || obj === null) return null;
	const v = Object.entries(obj).find(([k]) => k === key)?.[1];
	return typeof v === "number" ? v : null;
}

function stringField(obj: unknown, key: string): string | null {
	if (typeof obj !== "object" || obj === null) return null;
	const v = Object.entries(obj).find(([k]) => k === key)?.[1];
	return typeof v === "string" ? v : null;
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
	/** Service-worker-level listTabs handler (needs chrome.tabs.query). */
	handleListTabs: (id: string, params: unknown) => Promise<Response>;
	/** Service-worker-level closeTab handler (needs chrome.tabs.remove). */
	handleCloseTab: (id: string, params: unknown) => Promise<Response>;
	/** Service-worker-level createTab handler (needs chrome.tabs.create). */
	handleCreateTab: (id: string, params: unknown) => Promise<Response>;
	/** Service-worker-level exec handler (needs chrome.scripting in MAIN world). */
	handleExec: (id: string, params: unknown) => Promise<Response>;
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
		handleListTabs,
		handleCloseTab,
		handleCreateTab,
		handleExec,
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
		const startedAt = Date.now();
		const target: { tabId: number | null } = { tabId: null };
		void trackBusy(1);
		let resp: Response;
		try {
			resp = await route(request, target);
		} finally {
			void trackBusy(-1);
		}
		sendResponse(resp);
		await logAction(request, target.tabId, resp, startedAt);
	}

	async function route(
		request: Request,
		target: { tabId: number | null },
	): Promise<Response> {
		// ── Navigate: handle directly (content script destroyed on navigation) ─
		if (request.action === "navigate") {
			return handleNavigate(request.id, request.params);
		}

		// ── Screenshot: handle directly (no content script needed) ──────────
		if (request.action === "screenshot") {
			const resp = await handleScreenshot(request.id, request.params);
			return resp;
		}

		// ── ListTabs: handle directly (chrome.tabs API, no content script) ──
		if (request.action === "listTabs") {
			const resp = await handleListTabs(request.id, request.params);
			return resp;
		}

		// ── CloseTab: handle directly (chrome.tabs API, no content script) ──
		if (request.action === "closeTab") {
			const resp = await handleCloseTab(request.id, request.params);
			return resp;
		}

		// ── CreateTab: handle directly (chrome.tabs API, no content script) ─
		if (request.action === "createTab") {
			const resp = await handleCreateTab(request.id, request.params);
			return resp;
		}

		// ── Resolve the target tab for every remaining action ─────────────
		// All actions below (exec, click, type, read, waitFor*) accept an
		// optional `tabId` param. When omitted, we fall back to the active
		// tab. When provided, we validate the tab exists; this is the only
		// place that check lives, so each handler can trust the id.
		const params = request.params as Record<string, unknown> | undefined;
		const requestedTabId =
			typeof params?.tabId === "number" ? params.tabId : undefined;

		let targetTabId: number | null;
		if (requestedTabId !== undefined) {
			const existing = await getTab(requestedTabId);
			if (!existing) {
				return {
					id: request.id,
					error: {
						code: "TAB_NOT_FOUND",
						message: `Tab ${requestedTabId} does not exist or has been closed.`,
						suggestion: "Use listTabs to find a valid tabId.",
					},
				};
			}
			targetTabId = requestedTabId;
		} else {
			if (activeTabId.current === null) {
				activeTabId.current = await getActiveTabId();
			}
			targetTabId = activeTabId.current;
		}

		if (targetTabId === null) {
			return {
				id: request.id,
				error: {
					code: "BROWSER_NOT_CONNECTED",
					message: "No active tab available",
				},
			};
		}

		target.tabId = targetTabId;

		// ── Domain allowlist check against the *target* tab ────────────────
		const targetUrl =
			requestedTabId !== undefined
				? ((await getTab(targetTabId))?.url ?? null)
				: await getActiveTabUrl();
		if (targetUrl) {
			let hostname: string;
			try {
				hostname = new URL(targetUrl).hostname;
			} catch {
				hostname = "";
			}
			if (hostname) {
				const allowlist = await getAllowlist();
				if (!matchDomain(hostname, allowlist)) {
					return {
						id: request.id,
						error: {
							code: "RESTRICTED_DOMAIN",
							message: `Domain "${hostname}" is not in the allowlist.`,
							suggestion: `Add "${hostname}" to the extension popup's domain allowlist, or set it to "*" to allow all domains.`,
						},
					};
				}
			}
		}

		// ── Exec: handle directly in MAIN world via chrome.scripting ───────
		// Bypasses the extension's CSP. Works on most pages; on strict-CSP
		// pages the page's own unsafe-eval ban will still apply, but at
		// least the failure mode is the page's CSP, not ours.
		if (request.action === "exec") {
			const resp = await handleExec(request.id, {
				...(params ?? {}),
				tabId: targetTabId,
			});
			return resp;
		}

		// ── All other actions: forward to content script in the target tab ─
		const resp = await forwardToContentScript(targetTabId, request);
		return resp as Response;
	}

	async function logAction(
		request: Request,
		resolvedTabId: number | null,
		resp: Response,
		startedAt: number,
	): Promise<void> {
		const endedAt = Date.now();
		try {
			const tabId =
				numberField(resp.result, "tabId") ??
				numberField(request.params, "tabId") ??
				resolvedTabId;
			const url =
				request.action === "navigate" || request.action === "createTab"
					? stringField(request.params, "url")
					: tabId !== null
						? ((await getTab(tabId))?.url ?? null)
						: null;
			await appendActionLog(
				buildEntry({
					action: request.action,
					params: request.params,
					tabId,
					url,
					response: resp,
					startedAt,
					endedAt,
				}),
			);
		} catch (e: unknown) {
			logger.warn(`Action log write failed: ${e}`);
		}
	}

	function sendResponse(resp: Response): void {
		wsClient.send(serializeResponse(resp));
	}

	return handleIncomingMessage;
}
