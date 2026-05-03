/**
 * Chrome Runtime API wrappers.
 *
 * Wraps chrome.action (badge), chrome.tabs lifecycle events, and
 * chrome.runtime lifecycle events (onInstalled, storage.onChanged).
 *
 * Infrastructure layer — zero imports from domain/ or application/
 * (pure chrome.runtime / chrome.action wrappers).
 *
 * @module infrastructure/chrome-runtime
 */

// ── Connection status ─────────────────────────────────────────────────

/** Union of connection states used by the badge indicator. */
export type ConnectionStatus = "connected" | "disconnected" | "connecting";

const STATUS_CONFIG: Record<
	ConnectionStatus,
	{ badge: string; color: string; title: string }
> = {
	connected: {
		badge: "ON",
		color: "#22c55e",
		title: "Pi Browser Bridge — Connected",
	},
	disconnected: {
		badge: "OFF",
		color: "#ef4444",
		title: "Pi Browser Bridge — Disconnected",
	},
	connecting: {
		badge: "···",
		color: "#eab308",
		title: "Pi Browser Bridge — Connecting…",
	},
};

// ── Badge helpers ─────────────────────────────────────────────────────

/**
 * Update the extension toolbar badge to reflect the current connection status.
 */
export async function setStatusBadge(status: ConnectionStatus): Promise<void> {
	const cfg = STATUS_CONFIG[status];

	try {
		await chrome.action.setBadgeText({ text: cfg.badge });
		await chrome.action.setBadgeBackgroundColor({ color: cfg.color });
		await chrome.action.setTitle({ title: cfg.title });
	} catch {
		// Ignore — the service worker may not have a toolbar action.
	}
}

// ── Tab lifecycle listeners ───────────────────────────────────────────

/**
 * Register a callback that fires whenever the active tab changes.
 */
export function onTabActivated(callback: (tabId: number) => void): () => void {
	const listener = (activeInfo: { tabId: number; windowId: number }) => {
		callback(activeInfo.tabId);
	};
	chrome.tabs.onActivated.addListener(listener);
	return () => chrome.tabs.onActivated.removeListener(listener);
}

/**
 * Register a callback that fires whenever a tab is closed.
 */
export function onTabRemoved(callback: (tabId: number) => void): () => void {
	const listener = (tabId: number) => {
		callback(tabId);
	};
	chrome.tabs.onRemoved.addListener(listener);
	return () => chrome.tabs.onRemoved.removeListener(listener);
}

// ── Storage change listeners ──────────────────────────────────────────

/**
 * Register a callback that fires when a specific chrome.storage.local key changes.
 */
export function onStorageKeyChanged(
	key: string,
	callback: (newValue: unknown, oldValue: unknown) => void,
): () => void {
	const listener = (
		changes: Record<string, chrome.storage.StorageChange>,
		areaName: string,
	) => {
		if (areaName !== "local") return;
		const change = changes[key];
		if (!change) return;
		callback(change.newValue, change.oldValue);
	};
	chrome.storage.onChanged.addListener(listener);
	return () => chrome.storage.onChanged.removeListener(listener);
}

// ── Install / update listener ─────────────────────────────────────────

/**
 * Register a callback that fires on extension install or update.
 */
export function onInstalled(
	callback: (details: chrome.runtime.InstalledDetails) => void,
): () => void {
	chrome.runtime.onInstalled.addListener(callback);
	return () => chrome.runtime.onInstalled.removeListener(callback);
}

// ── Message listener ──────────────────────────────────────────────────

/** Signature for a chrome.runtime.onMessage listener. */
export type RuntimeMessageListener = Parameters<
	typeof chrome.runtime.onMessage.addListener
>[0];

/**
 * Register a runtime message listener.
 */
export function onRuntimeMessage(listener: RuntimeMessageListener): () => void {
	chrome.runtime.onMessage.addListener(listener);
	return () => chrome.runtime.onMessage.removeListener(listener);
}
