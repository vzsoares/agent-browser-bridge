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

import type { Logger } from "@pi-browser-bridge/logger";
import type { Response } from "@pi-browser-bridge/protocol";

import { sleep } from "../domain/index.js";
import { handleScreenshot } from "../application/handle-screenshot.js";
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
	activeTabId: { current: number | null },
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
	} catch (e) {
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
	} catch (e) {
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
				message:
					"'tabId' is required and must be a valid integer.",
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
	} catch (e) {
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
			const tabId =
				activeTabId.current ?? (await getActiveTabId());
			if (tabId === null) {
				return {
					id,
					error: {
						code: "BROWSER_NOT_CONNECTED" as const,
						message: "No active tab available for screenshot.",
						suggestion: "Ensure a tab is open and active in the browser window.",
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
