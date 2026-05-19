/**
 * Chrome Storage API wrappers.
 *
 * Wraps chrome.storage.local calls behind typed accessors for the bridge
 * configuration and domain allowlist. All chrome.storage.* access flows
 * through this module.
 *
 * Infrastructure layer — zero imports from domain/ or application/
 * (pure chrome.storage wrappers).
 *
 * @module infrastructure/chrome-storage
 */

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = "agent-browser-bridge";
export const ALLOWLIST_KEY = "domainAllowlist";
export const DEFAULT_PORT = 9242;
export const DEFAULT_ALLOWLIST = ["*"];

// ── Bridge config shape ──────────────────────────────────────────────────

/** Persistent bridge configuration stored in chrome.storage.local. */
export interface BridgeConfig {
	/** WebSocket server port (default 9242). */
	port: number;
	/** Whether the bridge is enabled. */
	enabled: boolean;
	/** Current connection status. */
	connectionStatus?: "connected" | "disconnected" | "connecting";
	/** ISO-8601 timestamp of last successful connection. */
	connectedAt?: string;
}

/** Domain allowlist stored in chrome.storage.local. */
export type DomainAllowlist = string[];

// ── Bridge config accessors ──────────────────────────────────────────────

/**
 * Read the full bridge configuration from chrome.storage.local.
 * Merges with sensible defaults for missing keys.
 */
export async function getBridgeConfig(): Promise<BridgeConfig> {
	const defaults: BridgeConfig = {
		port: DEFAULT_PORT,
		enabled: true,
	};

	try {
		const stored = (await chrome.storage.local.get(STORAGE_KEY)) as Record<
			string,
			unknown
		>;
		const cfg = stored[STORAGE_KEY] as Record<string, unknown> | undefined;

		if (cfg && typeof cfg === "object") {
			return {
				port:
					typeof cfg.port === "number" &&
					Number.isFinite(cfg.port) &&
					cfg.port > 0
						? cfg.port
						: DEFAULT_PORT,
				enabled: typeof cfg.enabled === "boolean" ? cfg.enabled : true,
				connectionStatus:
					cfg.connectionStatus === "connected" ||
					cfg.connectionStatus === "disconnected" ||
					cfg.connectionStatus === "connecting"
						? cfg.connectionStatus
						: undefined,
				connectedAt:
					typeof cfg.connectedAt === "string" ? cfg.connectedAt : undefined,
			};
		}
	} catch {
		// Storage unavailable — return defaults.
	}

	return defaults;
}

/**
 * Save (merge) a partial bridge configuration into chrome.storage.local.
 */
export async function saveBridgeConfig(
	patch: Partial<BridgeConfig>,
): Promise<void> {
	try {
		const stored = (await chrome.storage.local.get(STORAGE_KEY)) as Record<
			string,
			unknown
		>;
		const prev =
			(stored[STORAGE_KEY] as Record<string, unknown> | undefined) ?? {};
		await chrome.storage.local.set({
			[STORAGE_KEY]: { ...prev, ...patch },
		});
	} catch {
		// Failure is non-critical — the extension continues with in-memory state.
	}
}

// ── Port helpers (kept for backwards-compatible exports) ────────────────

/**
 * Read the WebSocket port from storage.
 *
 * @deprecated Use {@link getBridgeConfig} instead.
 */
export async function loadPort(): Promise<number> {
	const cfg = await getBridgeConfig();
	return cfg.port;
}

/**
 * Persist the WebSocket port to storage.
 *
 * @deprecated Use {@link saveBridgeConfig} instead.
 */
export async function savePort(port: number): Promise<void> {
	await saveBridgeConfig({ port });
}

// ── Domain allowlist accessors ───────────────────────────────────────────

/**
 * Read the domain allowlist from chrome.storage.local.
 * Returns the default `["*"]` allowlist when no value has been saved.
 */
export async function getAllowlist(): Promise<DomainAllowlist> {
	try {
		const stored = (await chrome.storage.local.get(ALLOWLIST_KEY)) as Record<
			string,
			unknown
		>;
		const raw = stored[ALLOWLIST_KEY];
		if (
			Array.isArray(raw) &&
			raw.length > 0 &&
			raw.every((v): v is string => typeof v === "string")
		) {
			return raw;
		}
	} catch {
		// Storage unavailable — return default.
	}
	return DEFAULT_ALLOWLIST;
}

/**
 * Persist a domain allowlist to chrome.storage.local.
 */
export async function saveAllowlist(allowlist: DomainAllowlist): Promise<void> {
	try {
		await chrome.storage.local.set({ [ALLOWLIST_KEY]: allowlist });
	} catch {
		// Non-critical.
	}
}

/**
 * Ensure the domain allowlist key exists in storage.
 * Called on first install and service-worker restart.
 */
export async function initializeAllowlist(): Promise<void> {
	try {
		const stored = (await chrome.storage.local.get(ALLOWLIST_KEY)) as Record<
			string,
			unknown
		>;
		if (stored[ALLOWLIST_KEY] === undefined) {
			await chrome.storage.local.set({ [ALLOWLIST_KEY]: DEFAULT_ALLOWLIST });
		}
	} catch {
		// Non-critical.
	}
}
