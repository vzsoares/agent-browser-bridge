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

import type { ConnectionStatus } from "./chrome-storage.js";

export type { ConnectionStatus };

interface BadgeStyle {
	badge: string;
	color: string;
	title: string;
}

export const STATUS_CONFIG: Record<ConnectionStatus, BadgeStyle> = {
	connected: {
		badge: "ON",
		color: "#22c55e",
		title: "Agent Browser Bridge — Connected",
	},
	disconnected: {
		badge: "OFF",
		color: "#6b7280",
		title: "Agent Browser Bridge — Off",
	},
	connecting: {
		badge: "…",
		color: "#f59e0b",
		title: "Agent Browser Bridge — Connecting…",
	},
	waiting: {
		badge: "IDLE",
		color: "#6b7280",
		title: "Agent Browser Bridge — Waiting for an agent",
	},
	unpaired: {
		badge: "KEY",
		color: "#ef4444",
		title: "Agent Browser Bridge — Not paired (paste the pairing token)",
	},
};

export const BUSY_BADGE: BadgeStyle = {
	badge: "ON",
	color: "#3b82f6",
	title: "Agent Browser Bridge — Running a request",
};

// ── Badge helpers ─────────────────────────────────────────────────────

let currentStatus: ConnectionStatus = "disconnected";
let busyCount = 0;

async function applyBadge(style: BadgeStyle): Promise<void> {
	try {
		await chrome.action.setBadgeText({ text: style.badge });
		await chrome.action.setBadgeBackgroundColor({ color: style.color });
		await chrome.action.setTitle({ title: style.title });
	} catch {
		// Ignore — the service worker may not have a toolbar action.
	}
}

function currentBadge(): BadgeStyle {
	return busyCount > 0 && currentStatus === "connected"
		? BUSY_BADGE
		: STATUS_CONFIG[currentStatus];
}

/** Update the toolbar badge to reflect the connection status. */
export async function setStatusBadge(status: ConnectionStatus): Promise<void> {
	currentStatus = status;
	await applyBadge(currentBadge());
}

/** Mark a request as running (`+1`) or finished (`-1`); busy shows while > 0. */
export async function trackBusy(delta: 1 | -1): Promise<void> {
	busyCount = Math.max(0, busyCount + delta);
	await applyBadge(currentBadge());
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
