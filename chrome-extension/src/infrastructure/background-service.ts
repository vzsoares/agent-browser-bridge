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
	ensureContentScript,
	executeScriptInTab,
	getActiveTabId,
	getTab,
	isRestrictedUrl,
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
 * 2. Call `chrome.tabs.update` to navigate the active tab
 * 3. Wait for the tab to finish loading (via `chrome.tabs.onUpdated`)
 * 4. Use `chrome.scripting.executeScript` to read the final URL and title
 */
async function serviceHandleNavigate(
	id: string,
	params: unknown,
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

	const tabId = activeTabId.current ?? (await getActiveTabId());
	if (tabId === null) {
		return {
			id,
			error: {
				code: "BROWSER_NOT_CONNECTED",
				message: "No active tab available for navigation.",
				suggestion: "Open a browser tab and make it active.",
			},
		};
	}

	// Detect same-page (hash-only) navigation — delegate to content script.
	try {
		const tab = await getTab(tabId);
		if (tab?.url) {
			const currentUrl = new URL(tab.url);
			const isSamePage =
				parsedUrl.origin === currentUrl.origin &&
				parsedUrl.pathname === currentUrl.pathname &&
				parsedUrl.search === currentUrl.search;

			if (isSamePage) {
				try {
					await ensureContentScript(tabId);
					const response = await chrome.tabs.sendMessage(tabId, {
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
		await updateTab(tabId, parsedUrl.href);
		await waitForTabComplete(tabId, timeoutMs);
		await sleep(100);

		const results = await executeScriptInTab(tabId, () => ({
			url: window.location.href,
			title: document.title,
		}));

		const pageInfo = results[0]?.result as
			| { url: string; title: string }
			| undefined;

		return {
			id,
			result: pageInfo ?? { url: parsedUrl.href, title: "" },
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
		handleNavigate: (id, p) => serviceHandleNavigate(id, p, activeTabId),
		handleScreenshot: (id, p) =>
			handleScreenshot(id, p, {
				captureVisibleTab,
				getActiveTabUrl: async () => {
					const tabId = activeTabId.current ?? (await getActiveTabId());
					if (tabId === null) return null;
					const tab = await getTab(tabId);
					return tab?.url ?? null;
				},
			}),
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
