import { createLogger } from "@pi-browser-bridge/logger";

const logger = createLogger("chrome-ext:popup");

// Popup script — Connection status, bridge toggle, and domain allowlist editor
logger.info("Popup loaded");

const STORAGE_KEY = "pi-browser-bridge";
const ALLOWLIST_KEY = "domainAllowlist";
const DEFAULT_ALLOWLIST = ["*"];

// ── Restricted URL schemes that chrome.tabs.query cannot access ─────────

const RESTRICTED_SCHEMES: string[] = [
	"chrome://",
	"chrome-extension://",
	"edge://",
	"about:",
	"devtools://",
];

function isRestrictedUrl(url: string | undefined): boolean {
	if (!url) return true;
	return RESTRICTED_SCHEMES.some((scheme: string) => url.startsWith(scheme));
}

// ── DOM elements ──────────────────────────────────────────────────────────

const statusDot = document.getElementById("status-dot");
const statusLabel = document.getElementById("status-label");
const infoPort = document.getElementById("info-port");
const infoConnected = document.getElementById("info-connected");
const infoConnectedAt = document.getElementById("info-connected-at");
const bridgeToggle = document.getElementById(
	"bridge-toggle",
) as HTMLInputElement | null;
const textarea = document.getElementById(
	"allowlist",
) as HTMLTextAreaElement | null;
const saveBtn = document.getElementById("save") as HTMLButtonElement | null;
const resetBtn = document.getElementById("reset") as HTMLButtonElement | null;
const statusMsg = document.getElementById(
	"status-msg",
) as HTMLDivElement | null;
const refreshTabsBtn = document.getElementById(
	"refresh-tabs",
) as HTMLButtonElement | null;
const tabListEl = document.getElementById("tab-list") as HTMLDivElement | null;

// ── Status helpers ────────────────────────────────────────────────────────

function setStatusMessage(message: string, success: boolean): void {
	if (!statusMsg) return;
	statusMsg.textContent = message;
	statusMsg.className = `status ${success ? "success" : "error"}`;
	setTimeout(() => {
		if (statusMsg) {
			statusMsg.textContent = "";
			statusMsg.className = "status";
		}
	}, 3000);
}

type ConnectionStatus = "connected" | "disconnected" | "connecting";

function updateStatusUI(status: ConnectionStatus, connectedAt?: string): void {
	if (statusDot) {
		statusDot.className = `status-dot ${status}`;
	}
	if (statusLabel) {
		statusLabel.className = `status-label ${status}`;
		statusLabel.textContent =
			status === "connected"
				? "Connected"
				: status === "connecting"
					? "Connecting…"
					: "Disconnected";
	}
	if (infoConnected && connectedAt) {
		infoConnected.style.display = "flex";
		if (infoConnectedAt) {
			infoConnectedAt.textContent = new Date(connectedAt).toLocaleTimeString();
		}
	} else if (infoConnected) {
		infoConnected.style.display = "none";
	}
}

async function loadBridgeState(): Promise<void> {
	try {
		const stored = (await chrome.storage.local.get(STORAGE_KEY)) as Record<
			string,
			unknown
		>;
		const cfg = stored[STORAGE_KEY] as Record<string, unknown> | undefined;

		if (cfg) {
			const status =
				(cfg.connectionStatus as ConnectionStatus) ?? "disconnected";
			const connectedAt = cfg.connectedAt as string | undefined;
			const port = typeof cfg.port === "number" ? cfg.port : 9242;
			const enabled = typeof cfg.enabled === "boolean" ? cfg.enabled : true;

			updateStatusUI(status, connectedAt);

			if (infoPort) infoPort.textContent = String(port);
			if (bridgeToggle) bridgeToggle.checked = enabled;
		} else {
			updateStatusUI("disconnected");
			if (infoPort) infoPort.textContent = "9242";
			if (bridgeToggle) bridgeToggle.checked = true;
		}
	} catch (e) {
		logger.error("Failed to load bridge state:", e);
		updateStatusUI("disconnected");
	}
}

// ── Storage change listener (real-time updates from service worker) ───────

chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName !== "local") return;
	const change = changes[STORAGE_KEY];
	if (!change) return;
	const state = change.newValue as Record<string, unknown> | undefined;
	if (state && typeof state === "object") {
		updateStatusUI(
			(state.connectionStatus as ConnectionStatus) ?? "disconnected",
			state.connectedAt as string | undefined,
		);
	}
});

// ── Toggle handler ─────────────────────────────────────────────────────────

bridgeToggle?.addEventListener("change", async () => {
	const enabled = bridgeToggle.checked;
	try {
		const stored = (await chrome.storage.local.get(STORAGE_KEY)) as Record<
			string,
			unknown
		>;
		const prev =
			(stored[STORAGE_KEY] as Record<string, unknown> | undefined) ?? {};
		await chrome.storage.local.set({ [STORAGE_KEY]: { ...prev, enabled } });
		setStatusMessage(enabled ? "Bridge enabled." : "Bridge disabled.", true);
	} catch (e) {
		logger.error("Failed to save enabled state:", e);
		setStatusMessage("Failed to toggle bridge.", false);
	}
});

// ── Allowlist: Load / Save / Reset ─────────────────────────────────────────

async function loadAllowlist(): Promise<void> {
	try {
		const stored = (await chrome.storage.local.get(ALLOWLIST_KEY)) as Record<
			string,
			unknown
		>;
		const raw = stored[ALLOWLIST_KEY];
		const list: string[] =
			Array.isArray(raw) && raw.every((v): v is string => typeof v === "string")
				? raw
				: DEFAULT_ALLOWLIST;
		if (textarea) {
			textarea.value = list.join("\n");
		}
	} catch (e) {
		logger.error("Failed to load allowlist:", e);
		if (textarea) {
			textarea.value = DEFAULT_ALLOWLIST.join("\n");
		}
	}
}

async function saveAllowlist(): Promise<void> {
	if (!textarea) return;

	const raw = textarea.value;
	const patterns = raw
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	if (patterns.length === 0) {
		setStatusMessage(
			"Allowlist cannot be empty. Use * to allow all domains.",
			false,
		);
		return;
	}

	try {
		await chrome.storage.local.set({ [ALLOWLIST_KEY]: patterns });
		setStatusMessage("Allowlist saved.", true);
	} catch (e) {
		logger.error("Failed to save allowlist:", e);
		setStatusMessage("Failed to save allowlist.", false);
	}
}

function resetAllowlist(): void {
	if (!textarea) return;
	textarea.value = DEFAULT_ALLOWLIST.join("\n");
	setStatusMessage("Reset to default (*). Click Save to apply.", true);
}

// ── Tab list ────────────────────────────────────────────────────────────────

const MAX_URL_LENGTH = 50;

function truncateUrl(url: string, maxLen: number): string {
	if (url.length <= maxLen) return url;
	return `${url.slice(0, maxLen)}…`;
}

async function loadTabs(): Promise<void> {
	if (!tabListEl) return;

	try {
		const tabs = await chrome.tabs.query({ currentWindow: true });
		const visibleTabs = tabs.filter(
			(tab) => tab.url !== undefined && !isRestrictedUrl(tab.url),
		);

		if (visibleTabs.length === 0) {
			tabListEl.innerHTML =
				'<span class="tab-list-empty">No accessible tabs</span>';
			return;
		}

		const activeTabId = tabs.find((t) => t.active)?.id;

		tabListEl.innerHTML = visibleTabs
			.map((tab) => {
				const title = tab.title || "Untitled";
				const url = tab.url ? truncateUrl(tab.url, MAX_URL_LENGTH) : "";
				const isActive = tab.id === activeTabId;
				return `
          <div class="tab-item${isActive ? " active" : ""}" data-tab-id="${tab.id}">
            <span class="tab-indicator"></span>
            <div class="tab-info">
              <span class="tab-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
              <span class="tab-url" title="${escapeHtml(tab.url ?? "")}">${escapeHtml(url)}</span>
            </div>
            <span class="tab-id">#${tab.id}</span>
          </div>
        `;
			})
			.join("");
	} catch (e) {
		logger.error("Failed to load tabs:", e);
		if (tabListEl) {
			tabListEl.innerHTML =
				'<span class="tab-list-empty">Failed to load tabs</span>';
		}
	}
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

refreshTabsBtn?.addEventListener("click", () => {
	void loadTabs();
});

// Listen for tab changes (URL change, title change, etc.)
chrome.tabs.onUpdated.addListener(() => {
	void loadTabs();
});

chrome.tabs.onRemoved.addListener(() => {
	void loadTabs();
});

chrome.tabs.onActivated.addListener(() => {
	void loadTabs();
});

chrome.tabs.onCreated.addListener(() => {
	void loadTabs();
});

// ── Event listeners ───────────────────────────────────────────────────────

saveBtn?.addEventListener("click", () => {
	void saveAllowlist();
});

resetBtn?.addEventListener("click", () => {
	resetAllowlist();
});

// ── Init ──────────────────────────────────────────────────────────────────

void loadBridgeState();
void loadAllowlist();
void loadTabs();
