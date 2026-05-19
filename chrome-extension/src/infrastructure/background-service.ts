/**
 * Background service worker orchestration.
 *
 * Initialises the service worker by wiring together:
 * - WebSocket client (with reconnect / keep-alive)
 * - Message router (parses & dispatches incoming messages)
 * - Chrome tab & storage API wrappers
 * - Tab lifecycle & storage-change listeners
 * - Navigate & screenshot handlers (require Chrome APIs)
 *
 * Infrastructure layer — imports from domain/, application/,
 * and sibling infrastructure modules.
 *
 * @module infrastructure/background-service
 */

import type { Logger } from "@agent-browser-bridge/logger";
import type { Response } from "@agent-browser-bridge/protocol";
import { handleScreenshot } from "../application/handle-screenshot.js";
import { sleep } from "../domain/index.js";
import {
	onInstalled,
	onStorageKeyChanged,
	onTabActivated,
	onTabRemoved,
} from "./chrome-runtime.js";
import {
	getBridgeConfig,
	initializeAllowlist,
	loadPort,
	STORAGE_KEY,
	savePort,
} from "./chrome-storage.js";
import {
	captureVisibleTab,
	closeTab,
	createTab,
	ensureContentScript,
	executeScriptInTab,
	getActiveTabId,
	getTab,
	isRestrictedUrl,
	listTabs,
	removeInjected,
	updateTab,
	waitForTabComplete,
} from "./chrome-tabs.js";
import { createMessageRouter } from "./message-router.js";
import { WebSocketClient } from "./websocket-client.js";

// ── Navigate handler (service-worker level) ────────────────────────────

/**
 * Handle the `navigate` action directly in the service worker.
 *
 * Content scripts are destroyed on cross-page navigation, so the service
 * worker orchestrates the full lifecycle:
 * 1. Validate the target URL
 * 2. If tabId is provided, navigate that tab in-place via `chrome.tabs.update`.
 *    If tabId is NOT provided, create a new tab (inactive) and navigate there.
 * 3. Wait for the tab to finish loading (via `chrome.tabs.onUpdated`)
 * 4. Use `chrome.scripting.executeScript` to read the final URL and title
 */
async function serviceHandleNavigate(
	id: string,
	params: unknown,
	tabId: number | undefined,
	_activeTabId: { current: number | null },
): Promise<Response> {
	const p = params as Record<string, unknown> | null | undefined;
	const url = p?.url;

	if (!url || typeof url !== "string") {
		return {
			id,
			error: {
				code: "INVALID_URL",
				message: "URL is required and must be a string.",
				suggestion: "Provide a fully-qualified URL like https://example.com",
			},
		};
	}

	let parsedUrl: URL;
	try {
		parsedUrl = new URL(url);
	} catch {
		return {
			id,
			error: {
				code: "INVALID_URL",
				message: `Invalid URL format: "${url}"`,
				suggestion: "Provide a fully-qualified URL like https://example.com",
			},
		};
	}

	if (isRestrictedUrl(parsedUrl.href)) {
		return {
			id,
			error: {
				code: "RESTRICTED_URL",
				message: `Navigation to restricted URL scheme is blocked: ${parsedUrl.protocol}//`,
				suggestion:
					"Use https:// URLs for web pages. chrome:// and similar schemes are blocked.",
			},
		};
	}

	const waitUntil = (p?.waitUntil as string) ?? "load";
	const timeoutMs =
		typeof p?.timeout === "number" && Number.isFinite(p.timeout)
			? p.timeout
			: 30000;

	// Determine which tab to navigate.
	let targetTabId: number;

	if (tabId !== undefined) {
		// Tab ID was provided — validate it exists.
		const existing = await getTab(tabId);
		if (!existing) {
			return {
				id,
				error: {
					code: "TAB_NOT_FOUND",
					message: `Tab ${tabId} does not exist or has been closed.`,
					suggestion: "Use listTabs to find a valid tabId.",
				},
			};
		}
		targetTabId = tabId;
	} else {
		// No tabId provided — create a new inactive tab.
		const newTab = await createTab(undefined, false);
		if (!newTab.id) {
			return {
				id,
				error: {
					code: "BROWSER_NOT_CONNECTED",
					message: "Failed to create a new tab.",
					suggestion: "Ensure the browser is running and responsive.",
				},
			};
		}
		targetTabId = newTab.id;
	}

	// Detect same-page (hash-only) navigation — delegate to content script.
	try {
		const tab = await getTab(targetTabId);
		if (tab?.url) {
			const currentUrl = new URL(tab.url);
			const isSamePage =
				parsedUrl.origin === currentUrl.origin &&
				parsedUrl.pathname === currentUrl.pathname &&
				parsedUrl.search === currentUrl.search;

			if (isSamePage) {
				try {
					await ensureContentScript(targetTabId);
					const response = await chrome.tabs.sendMessage(targetTabId, {
						id,
						action: "navigate",
						params: { url, waitUntil, timeout: timeoutMs },
					});
					if (response && typeof response === "object") {
						return response as Response;
					}
				} catch {
					// Content script unavailable — fall through to full navigation.
				}
			}
		}
	} catch {
		// Tab may not exist — proceed with full navigation.
	}

	// Full cross-page navigation.
	try {
		await updateTab(targetTabId, parsedUrl.href);
		await waitForTabComplete(targetTabId, timeoutMs);
		await sleep(100);

		const results = await executeScriptInTab(targetTabId, () => ({
			url: window.location.href,
			title: document.title,
		}));

		const pageInfo = results[0]?.result as
			| { url: string; title: string }
			| undefined;

		return {
			id,
			result: {
				...(pageInfo ?? { url: parsedUrl.href, title: "" }),
				tabId: targetTabId,
			},
		};
	} catch (e: unknown) {
		const err = e instanceof Error ? e.message : String(e);

		if (
			err.toLowerCase().includes("timeout") ||
			err.toLowerCase().includes("timed out")
		) {
			return {
				id,
				error: {
					code: "TIMEOUT",
					message: `Navigation timed out after ${timeoutMs}ms: ${err}`,
					suggestion:
						"The page took too long to load. Try increasing the timeout or check the URL.",
				},
			};
		}

		if (
			err.includes("chrome://") ||
			err.includes("restricted") ||
			err.includes("not allowed") ||
			err.includes("Cannot access")
		) {
			return {
				id,
				error: {
					code: "RESTRICTED_URL",
					message: `Navigation blocked: ${err}`,
					suggestion: "Use https:// URLs for web pages.",
				},
			};
		}

		return {
			id,
			error: {
				code: "UNKNOWN_ACTION",
				message: `Navigation failed: ${err}`,
			},
		};
	}
}

// ── List tabs handler (service-worker level) ────────────────────────

/**
 * Handle the `listTabs` action directly in the service worker.
 *
 * Content scripts cannot access `chrome.tabs.query`, so this must run
 * in the extension context.
 */
async function serviceHandleListTabs(
	id: string,
	params: unknown,
): Promise<Response> {
	const p = params as Record<string, unknown> | null | undefined;

	const urlPattern =
		p?.urlPattern !== undefined
			? typeof p.urlPattern === "string"
				? p.urlPattern
				: undefined
			: undefined;

	const currentWindowOnly =
		p?.currentWindowOnly !== undefined
			? typeof p.currentWindowOnly === "boolean"
				? p.currentWindowOnly
				: true
			: true;

	try {
		const tabs = await listTabs(urlPattern, currentWindowOnly);
		return { id, result: { tabs } };
	} catch (e: unknown) {
		const err = e instanceof Error ? e.message : String(e);
		return {
			id,
			error: {
				code: "UNKNOWN_ACTION",
				message: `Failed to list tabs: ${err}`,
			},
		};
	}
}

// ── Exec handler (service-worker level) ─────────────────────────────

/**
 * Self-contained page-world evaluator. Injected verbatim via
 * `chrome.scripting.executeScript({ world: "MAIN", func })`.
 *
 * Inlined intentionally — no closures, no imports — because Chrome
 * serializes this function's source and re-instantiates it in the page
 * world. Anything captured from the surrounding scope wouldn't survive.
 */
function pageExecEvaluator(codeStr: string): {
	ok: boolean;
	serialized?: string;
	error?: string;
} {
	const MAX = 10_000;

	function serialize(v: unknown): string {
		if (v === null) return "null";
		if (v === undefined) return "undefined";
		const t = typeof v;
		if (t === "string") return v as string;
		if (t === "number" || t === "boolean") return String(v);
		if (t === "bigint") return `${(v as bigint).toString()}n`;
		if (t === "function") {
			const n = (v as { name?: string }).name || "anonymous";
			return `[Function: ${n}]`;
		}
		if (t === "symbol") {
			const d = (v as symbol).description;
			return d ? `[Symbol: ${d}]` : "[Symbol]";
		}
		try {
			return JSON.stringify(v, null, 2) ?? String(v);
		} catch {
			const seen = new WeakSet<object>();
			return JSON.stringify(
				v,
				(_k, val: unknown) => {
					if (typeof val === "object" && val !== null) {
						if (seen.has(val)) return "[Circular]";
						seen.add(val);
					}
					if (typeof val === "function") return "[Function]";
					if (typeof val === "bigint") return `${val.toString()}n`;
					return val;
				},
				2,
			);
		}
	}

	function clamp(s: string): string {
		if (s.length <= MAX) return s;
		return `${s.slice(0, MAX)}\n... [truncated at ${MAX} chars, total ${s.length}]`;
	}

	try {
		const fn = new Function(`"use strict"; return (${codeStr})`);
		const raw = fn();
		if (
			raw &&
			typeof raw === "object" &&
			typeof (raw as { then?: unknown }).then === "function"
		) {
			// Async path — propagate the promise so the caller awaits it.
			return (raw as Promise<unknown>).then(
				(v) => ({ ok: true, serialized: clamp(serialize(v)) }),
				(err: unknown) => ({
					ok: false,
					error: err instanceof Error ? err.message : String(err),
				}),
			) as unknown as { ok: boolean; serialized?: string; error?: string };
		}
		return { ok: true, serialized: clamp(serialize(raw)) };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Handle the `exec` action at the service-worker level via
 * `chrome.scripting.executeScript({ world: "MAIN" })`.
 *
 * Running in the MAIN world means the extension's own CSP doesn't apply —
 * only the page's CSP does. On normal pages this Just Works; on hardened
 * pages (Datadog and friends) the page's `unsafe-eval` ban will still
 * block `new Function`, and we surface a clear error.
 */
async function serviceHandleExec(
	id: string,
	params: unknown,
	tabId: number,
): Promise<Response> {
	const p = params as { code?: string } | null | undefined;
	if (!p || typeof p.code !== "string" || p.code.trim().length === 0) {
		return {
			id,
			error: {
				code: "UNKNOWN_ACTION",
				message: "Missing or invalid 'code' parameter.",
				suggestion: "Provide a string of JavaScript code to execute.",
			},
		};
	}

	try {
		const results = await chrome.scripting.executeScript({
			target: { tabId },
			world: "MAIN",
			args: [p.code],
			func: pageExecEvaluator,
		});
		const payload = results[0]?.result as
			| { ok: boolean; serialized?: string; error?: string }
			| undefined;

		if (!payload) {
			return {
				id,
				error: {
					code: "UNKNOWN_ACTION",
					message: "Exec returned no result.",
				},
			};
		}

		if (payload.ok) {
			return { id, result: { tabId, serialized: payload.serialized ?? "" } };
		}

		const err = payload.error ?? "Unknown error";
		// Translate page-CSP eval blocks into a friendlier code so callers can
		// react (e.g. fall back to read-only operations).
		if (
			/unsafe-eval|Content Security Policy|new Function/.test(err) ||
			/EvalError/.test(err)
		) {
			return {
				id,
				error: {
					code: "UNKNOWN_ACTION",
					message: `Exec blocked by the page's Content Security Policy: ${err}`,
					suggestion:
						"The page forbids dynamic JS evaluation. Use browser_read / browser_click / browser_type for DOM interactions on this page.",
				},
			};
		}
		return {
			id,
			error: { code: "UNKNOWN_ACTION", message: `Exec failed: ${err}` },
		};
	} catch (e) {
		const err = e instanceof Error ? e.message : String(e);
		// Chrome itself blocks scripting on chrome:// and a handful of other
		// origins — surface that distinctly.
		if (
			err.includes("Cannot access") ||
			err.includes("chrome://") ||
			err.includes("restricted")
		) {
			return {
				id,
				error: {
					code: "RESTRICTED_URL",
					message: `Exec is not permitted on this page: ${err}`,
					suggestion: "Navigate to an https:// page and retry.",
				},
			};
		}
		return {
			id,
			error: { code: "UNKNOWN_ACTION", message: `Exec failed: ${err}` },
		};
	}
}

// ── Create tab handler (service-worker level) ───────────────────────

/**
 * Handle the `createTab` action directly in the service worker.
 *
 * Validates the optional URL, opens a new tab via `chrome.tabs.create`,
 * waits for it to finish loading when a URL is provided, and returns the
 * resulting `{ tabId, url, title }`.
 */
async function serviceHandleCreateTab(
	id: string,
	params: unknown,
): Promise<Response> {
	const p = (params ?? {}) as Record<string, unknown>;
	const rawUrl = p.url;
	const active = typeof p.active === "boolean" ? p.active : true;

	let url: string | undefined;
	if (rawUrl !== undefined && rawUrl !== null && rawUrl !== "") {
		if (typeof rawUrl !== "string") {
			return {
				id,
				error: {
					code: "INVALID_URL",
					message: "'url' must be a string.",
					suggestion: "Provide a fully-qualified URL like https://example.com",
				},
			};
		}
		let parsed: URL;
		try {
			parsed = new URL(rawUrl);
		} catch {
			return {
				id,
				error: {
					code: "INVALID_URL",
					message: `Invalid URL format: "${rawUrl}"`,
					suggestion: "Provide a fully-qualified URL like https://example.com",
				},
			};
		}
		if (isRestrictedUrl(parsed.href)) {
			return {
				id,
				error: {
					code: "RESTRICTED_URL",
					message: `Cannot open restricted URL scheme in a new tab: ${parsed.protocol}//`,
					suggestion: "Use https:// URLs for web pages.",
				},
			};
		}
		url = parsed.href;
	}

	try {
		const tab = await createTab(url, active);
		if (!tab.id) {
			return {
				id,
				error: {
					code: "BROWSER_NOT_CONNECTED",
					message: "Failed to create a new tab (no id assigned).",
				},
			};
		}

		// If we asked for a URL, wait for the load to settle so the caller
		// gets a real title back.
		if (url) {
			try {
				await waitForTabComplete(tab.id, 30_000);
				await sleep(100);
			} catch {
				// Load timed out — fall through and return whatever metadata we have.
			}
		}

		const fresh = await getTab(tab.id);
		return {
			id,
			result: {
				tabId: tab.id,
				url: fresh?.url ?? url ?? "",
				title: fresh?.title ?? "",
			},
		};
	} catch (e) {
		const err = e instanceof Error ? e.message : String(e);
		return {
			id,
			error: {
				code: "UNKNOWN_ACTION",
				message: `Failed to create tab: ${err}`,
			},
		};
	}
}

// ── Close tab handler (service-worker level) ────────────────────────

/**
 * Handle the `closeTab` action directly in the service worker.
 *
 * Content scripts cannot access `chrome.tabs.remove`, so this must run
 * in the extension context.
 */
async function serviceHandleCloseTab(
	id: string,
	params: unknown,
): Promise<Response> {
	const p = params as Record<string, unknown> | null | undefined;
	const tabId = p?.tabId;

	if (typeof tabId !== "number" || !Number.isInteger(tabId)) {
		return {
			id,
			error: {
				code: "TAB_NOT_FOUND",
				message: "'tabId' is required and must be a valid integer.",
				suggestion: "Use listTabs to find a valid tabId.",
			},
		};
	}

	// Check if the tab exists before attempting to close it.
	const existing = await getTab(tabId);
	if (!existing) {
		return {
			id,
			error: {
				code: "TAB_NOT_FOUND",
				message: `Tab ${tabId} does not exist or has been closed.`,
				suggestion: "Use listTabs to find a valid tabId.",
			},
		};
	}

	try {
		await closeTab(tabId);
		return { id, result: { closed: true } };
	} catch (e: unknown) {
		const err = e instanceof Error ? e.message : String(e);
		return {
			id,
			error: {
				code: "UNKNOWN_ACTION",
				message: `Failed to close tab: ${err}`,
			},
		};
	}
}

// ── Service worker initialization ──────────────────────────────────────

/**
 * Initialize the background service worker.
 *
 * Reads config, sets up WebSocket, message routing, tab lifecycle
 * listeners, and storage-change listeners. Call once at service-worker
 * startup.
 */
export async function init(logger: Logger): Promise<{
	connect: () => void;
	getActiveTabId: () => Promise<number | null>;
	loadPort: () => Promise<number>;
	savePort: (port: number) => Promise<void>;
}> {
	logger.info("Background service worker started");

	// ── Read configuration ──────────────────────────────────────────
	const cfg = await getBridgeConfig();
	let port = cfg.port;
	const enabledRef = { current: cfg.enabled };
	logger.info(
		`Bridge ${enabledRef.current ? "enabled" : "disabled"} (from storage)`,
	);

	// ── Ensure allowlist exists ─────────────────────────────────────
	await initializeAllowlist();

	// ── Mutable state ───────────────────────────────────────────────
	const activeTabId = { current: await getActiveTabId() };
	if (activeTabId.current !== null) {
		logger.info(`Initial active tab: ${activeTabId.current}`);
	} else {
		logger.warn("No active tab found on startup");
	}

	// ── Message handler pre-creation (needs wsClient) ───────────────
	// We create the WebSocket client with a placeholder onMessage,
	// then wire the real message router after both exist.
	let handleMessage: (raw: string) => Promise<void>;

	const wsClient = new WebSocketClient({
		port,
		logger,
		onMessage: (raw: string) => {
			void handleMessage(raw);
		},
	});

	// ── Message router ──────────────────────────────────────────────
	handleMessage = createMessageRouter({
		logger,
		wsClient,
		enabled: enabledRef,
		activeTabId,
		handleNavigate: (id, p) => {
			const pTyped = p as Record<string, unknown> | null | undefined;
			const reqTabId =
				typeof pTyped?.tabId === "number" ? pTyped.tabId : undefined;
			return serviceHandleNavigate(id, p, reqTabId, activeTabId);
		},
		handleScreenshot: async (id, p) => {
			const tabId = activeTabId.current ?? (await getActiveTabId());
			if (tabId === null) {
				return {
					id,
					error: {
						code: "BROWSER_NOT_CONNECTED" as const,
						message: "No active tab available for screenshot.",
						suggestion:
							"Ensure a tab is open and active in the browser window.",
					},
				};
			}
			return handleScreenshot(id, p, {
				captureVisibleTab,
				getActiveTabUrl: async () => {
					const tab = await getTab(tabId);
					return tab?.url ?? null;
				},
				activeTabId: tabId,
			});
		},
		handleListTabs: (id, p) => serviceHandleListTabs(id, p),
		handleCloseTab: (id, p) => serviceHandleCloseTab(id, p),
		handleCreateTab: (id, p) => serviceHandleCreateTab(id, p),
		handleExec: async (id, p) => {
			// message-router has already resolved + validated `tabId` in `p`.
			const pTyped = p as Record<string, unknown> | null | undefined;
			const tabId =
				typeof pTyped?.tabId === "number"
					? pTyped.tabId
					: (activeTabId.current ?? (await getActiveTabId()));
			if (tabId === null) {
				return {
					id,
					error: {
						code: "BROWSER_NOT_CONNECTED" as const,
						message: "No active tab available for exec.",
						suggestion:
							"Ensure a tab is open and active in the browser window.",
					},
				};
			}
			return serviceHandleExec(id, p, tabId);
		},
	});

	// ── Tab lifecycle listeners ─────────────────────────────────────
	onTabActivated((tabId) => {
		logger.info(`Active tab changed to ${tabId}`);
		activeTabId.current = tabId;
	});

	onTabRemoved((tabId) => {
		removeInjected(tabId);
		if (activeTabId.current === tabId) {
			activeTabId.current = null;
		}
	});

	// ── Storage change listener ─────────────────────────────────────
	onStorageKeyChanged(STORAGE_KEY, (newValue) => {
		const state = newValue as Record<string, unknown> | undefined;
		if (state && typeof state === "object") {
			if ("enabled" in state && typeof state.enabled === "boolean") {
				enabledRef.current = state.enabled;
				logger.info(
					`Bridge ${enabledRef.current ? "enabled" : "disabled"} (from storage change)`,
				);
			}
			if (
				"port" in state &&
				typeof state.port === "number" &&
				Number.isFinite(state.port) &&
				state.port > 0
			) {
				port = state.port;
				wsClient.setPort(port);
			}
		}
	});

	// ── Install listener ────────────────────────────────────────────
	onInstalled(async () => {
		await initializeAllowlist();
		logger.info("Extension installed/updated — allowlist initialised");
	});

	// ── Internal ping response handler ──────────────────────────────
	chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
		if (
			message &&
			typeof message === "object" &&
			(message as Record<string, unknown>).type === "pong"
		) {
			sendResponse({ type: "ack" });
		}
		return false;
	});

	// ── Return public API ───────────────────────────────────────────
	return {
		connect: () => wsClient.connect(),
		getActiveTabId: () => getActiveTabId(),
		loadPort,
		savePort,
	};
}
