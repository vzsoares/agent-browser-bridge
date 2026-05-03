/**
 * Infrastructure layer barrel export.
 *
 * Re-exports all infrastructure modules so the entry points
 * (background.ts and content/index.ts) can import from a single location.
 *
 * @module infrastructure
 */

// ── Chrome API wrappers ───────────────────────────────────────────────

export {
	type ConnectionStatus,
	onInstalled,
	onRuntimeMessage,
	onStorageKeyChanged,
	onTabActivated,
	onTabRemoved,
	type RuntimeMessageListener,
	setStatusBadge,
} from "./chrome-runtime.js";

export {
	ALLOWLIST_KEY,
	type BridgeConfig,
	DEFAULT_ALLOWLIST,
	DEFAULT_PORT,
	type DomainAllowlist,
	getAllowlist,
	getBridgeConfig,
	initializeAllowlist,
	loadPort,
	STORAGE_KEY,
	saveAllowlist,
	saveBridgeConfig,
	savePort,
} from "./chrome-storage.js";
export {
	captureVisibleTab,
	closeTab,
	ensureContentScript,
	executeScriptInTab,
	forwardToContentScript,
	getActiveTabId,
	getActiveTabUrl,
	getTab,
	isInjected,
	isRestrictedUrl,
	listTabs,
	markInjected,
	removeInjected,
	sendMessageToTab,
	updateTab,
	waitForTabComplete,
} from "./chrome-tabs.js";

// ── WebSocket client ─────────────────────────────────────────────────

export {
	WebSocketClient,
	type WebSocketClientOptions,
} from "./websocket-client.js";

// ── Message routing ──────────────────────────────────────────────────

export {
	createMessageRouter,
	type MessageRouterOptions,
} from "./message-router.js";

// ── Content script listener ───────────────────────────────────────────

export {
	type ContentListenerConfig,
	createContentListener,
} from "./content-listener.js";

// ── Background service orchestration ──────────────────────────────────

export { init } from "./background-service.js";
