import type { Action, ActionParams, ErrorResponse, Request, Response } from "@pi-browser-bridge/protocol";

// ── Constants ────────────────────────────────────────────────────────────

const STORAGE_KEY = "pi-browser-bridge";
const DEFAULT_PORT = 9242;

/** URL prefixes that are blocked from screenshots and content-script injection. */
const RESTRICTED_URL_RE = /^(chrome|chrome-extension|about|edge|brave):\/\//i;

/** chrome.storage.local key for the domain allowlist. */
const ALLOWLIST_KEY = "domainAllowlist";

/** Default allowlist — allows all domains. */
const DEFAULT_ALLOWLIST = ["*"];

// ── Domain allowlist helpers ────────────────────────────────────────────

/**
 * Convert a glob-style domain pattern to a case-insensitive RegExp.
 *
 * - `*` as a standalone token matches exactly one subdomain label (anything
 *   except `.`).
 * - `?` matches exactly one non-dot character.
 * - All other regex-special characters are escaped literally.
 *
 * @example
 *   globToRegex("*.example.com")  →  /^[^.]+\\.example\\.com$/i
 *   globToRegex("example.com")    →  /^example\\.com$/i
 */
function globToRegex(pattern: string): RegExp {
  let regex = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern.charAt(i);
    if (ch === "*") {
      // Match a single subdomain label — one or more non-dot characters.
      regex += "[^.]+";
    } else if (ch === "?") {
      regex += "[^.]";
    } else if (".^$+={}[]|\\()".includes(ch)) {
      regex += "\\" + ch;
    } else {
      regex += ch;
    }
  }
  return new RegExp(`^${regex}$`, "i");
}

/**
 * Test whether a hostname matches any pattern in the allowlist.
 *
 * The literal pattern `"*"` matches every hostname (allow-all sentinel).
 */
function matchDomain(hostname: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    const trimmed = pattern.trim();
    if (trimmed === "") continue;
    if (trimmed === "*") return true;
    // Skip comment lines (optional UX nicety in the textarea).
    if (trimmed.startsWith("#")) continue;
    const re = globToRegex(trimmed);
    if (re.test(hostname)) return true;
  }
  return false;
}

// ── State ─────────────────────────────────────────────────────────────────

type ConnectionStatus = "connected" | "disconnected" | "connecting";

let ws: WebSocket | null = null;
let port: number = DEFAULT_PORT;
let activeTabId: number | null = null;
const injectedTabs = new Set<number>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
let enabled = true;

// ── Connection status indicator ───────────────────────────────────────────

const STATUS_CONFIG: Record<ConnectionStatus, { badge: string; color: string; title: string }> = {
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

async function setStatus(status: ConnectionStatus): Promise<void> {
  const cfg = STATUS_CONFIG[status];

  try {
    await chrome.action.setBadgeText({ text: cfg.badge });
    await chrome.action.setBadgeBackgroundColor({ color: cfg.color });
    await chrome.action.setTitle({ title: cfg.title });
  } catch (e) {
    // Ignore errors — e.g. service worker may not have an action toolbar.
  }

  try {
    const stored = (await chrome.storage.local.get(STORAGE_KEY)) as Record<string, unknown>;
    const prev = (stored[STORAGE_KEY] as Record<string, unknown> | undefined) ?? {};
    const patch: Record<string, unknown> = { ...prev, connectionStatus: status };
    if (status === "connected") {
      patch.connectedAt = new Date().toISOString();
    } else if (status === "disconnected") {
      delete patch.connectedAt;
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: patch });
  } catch (e) {
    // Non-critical — the popup can fall back to polling.
  }
}

// ── Logging ───────────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`[pi-browser-bridge] ${msg}`);
}

function warn(msg: string): void {
  console.warn(`[pi-browser-bridge] ${msg}`);
}

function error(msg: string): void {
  console.error(`[pi-browser-bridge] ${msg}`);
}

// ── Config ────────────────────────────────────────────────────────────────

async function loadPort(): Promise<number> {
  try {
    const stored = (await chrome.storage.local.get(STORAGE_KEY)) as Record<string, unknown>;
    const cfg = stored[STORAGE_KEY];
    if (cfg && typeof cfg === "object" && "port" in cfg) {
      const portVal = (cfg as Record<string, unknown>).port;
      if (typeof portVal === "number" && Number.isFinite(portVal) && portVal > 0) {
        log(`Loaded port from storage: ${portVal}`);
        return portVal;
      }
    }
  } catch (e) {
    warn(`Failed to read port from storage: ${e}`);
  }
  log(`Using default port: ${DEFAULT_PORT}`);
  return DEFAULT_PORT;
}

async function savePort(value: number): Promise<void> {
  try {
    const stored = (await chrome.storage.local.get(STORAGE_KEY)) as Record<string, unknown>;
    const prev = (stored[STORAGE_KEY] as Record<string, unknown> | undefined) ?? {};
    await chrome.storage.local.set({ [STORAGE_KEY]: { ...prev, port: value } });
  } catch (e) {
    warn(`Failed to save port to storage: ${e}`);
  }
}

// ── Domain allowlist storage ────────────────────────────────────────────

/**
 * Read the domain allowlist from chrome.storage.local.
 * Returns the default `["*"]` allowlist when no value has been saved yet.
 */
async function getAllowlist(): Promise<string[]> {
  try {
    const stored = (await chrome.storage.local.get(ALLOWLIST_KEY)) as Record<string, unknown>;
    const raw = stored[ALLOWLIST_KEY];
    if (Array.isArray(raw) && raw.length > 0 && raw.every((v): v is string => typeof v === "string")) {
      return raw;
    }
  } catch (e) {
    warn(`Failed to read allowlist from storage: ${e}`);
  }
  return DEFAULT_ALLOWLIST;
}

// ── Active tab tracking ───────────────────────────────────────────────────

async function getActiveTabId(): Promise<number | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  } catch (e) {
    error(`Failed to query active tab: ${e}`);
    return null;
  }
}

/** Return the URL of the currently-active tab, or null if unavailable. */
async function getActiveTabUrl(): Promise<string | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url ?? null;
  } catch {
    return null;
  }
}

// ── Content script injection tracking ─────────────────────────────────────

function markContentScriptInjected(tabId: number): void {
  injectedTabs.add(tabId);
}

function isContentScriptInjected(tabId: number): boolean {
  return injectedTabs.has(tabId);
}

// ── Connect to the content script (via manifest auto-injection) ───────────

/**
 * Ping the content script in the given tab to verify it's loaded.
 * The manifest auto-injects the content script, but we verify readiness
 * on first use so we can provide a clear error if it's missing.
 */
async function ensureContentScript(tabId: number): Promise<void> {
  // If we've already verified, skip the ping.
  if (isContentScriptInjected(tabId)) return;

  try {
    // Send a lightweight ping. If the content script is present, it will
    // respond. If not, chrome.runtime.lastError will be set on the sendMessage
    // call — but the Promise API surfaces that as a rejection (the message port
    // closed before a response was received).
    await chrome.tabs.sendMessage(tabId, { type: "ping" });
    markContentScriptInjected(tabId);
  } catch {
    // The content script is not injected (e.g. chrome:// pages, extensions
    // pages, or the tab hasn't fully loaded yet). Mark as uninjected so we
    // retry on the next request.
    injectedTabs.delete(tabId);
    throw new Error(`Content script not available in tab ${tabId}. The page may be a restricted URL or still loading.`);
  }
}

// ── WebSocket connection management ────────────────────────────────────────

function cancelReconnect(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

/** Interval between keep-alive pings (ms). Prevents Chrome from terminating the service worker. */
const KEEP_ALIVE_INTERVAL = 20_000;

function startKeepAlive(): void {
  stopKeepAlive();
  keepAliveTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "ping" }));
      } catch (e) {
        warn(`Keep-alive ping failed: ${e}`);
      }
    }
  }, KEEP_ALIVE_INTERVAL);
}

function stopKeepAlive(): void {
  if (keepAliveTimer !== null) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function scheduleReconnect(): void {
  cancelReconnect();
  reconnectAttempt++;
  // Exponential backoff capped at 30 seconds.
  const delay = Math.min(1000 * 2 ** (reconnectAttempt - 1), 30_000);
  log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempt})…`);
  void setStatus("connecting");
  reconnectTimer = setTimeout(connect, delay);
}

function connect(): void {
  // Cancel any pending reconnect and stop keep-alive from a previous connection.
  cancelReconnect();
  stopKeepAlive();
  void setStatus("connecting");

  // Suppress stale events from an existing connection before replacing it.
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    try {
      ws.close();
    } catch {
      // Ignore errors during cleanup.
    }
    ws = null;
  }

  const url = `ws://localhost:${port}`;
  log(`Connecting to ${url}…`);

  try {
    ws = new WebSocket(url);
  } catch (e) {
    error(`Failed to create WebSocket: ${e}`);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    log("WebSocket connected");
    reconnectAttempt = 0; // Reset backoff on successful connection.
    startKeepAlive();     // Begin keep-alive pings to prevent service-worker termination.
    void setStatus("connected");
  };

  ws.onclose = (event) => {
    log(`WebSocket closed (code=${event.code}, reason="${event.reason || ""}", wasClean=${event.wasClean})`);
    stopKeepAlive();
    ws = null;
    if (event.code !== 1000) {
      // 1000 = Normal Closure — don't reconnect for intentional shutdown.
      setStatus("connecting");
      scheduleReconnect();
    } else {
      void setStatus("disconnected");
    }
  };

  ws.onerror = () => {
    error(`WebSocket error. ReadyState: ${ws?.readyState ?? "null"}`);
    void setStatus("disconnected");
    // onclose will fire after onerror, so reconnection is handled there.
  };

  ws.onmessage = (event) => {
    handleIncomingMessage(event.data).catch((e) =>
      error(`Unhandled error in message handler: ${e}`),
    );
  };
}

// ── Message handling ──────────────────────────────────────────────────────

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
      error: { code: "UNKNOWN_ACTION", message: "Request must be a JSON object" },
    };
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.id !== "string" || obj.id.length === 0) {
    return {
      id: "",
      error: { code: "UNKNOWN_ACTION", message: "Missing or invalid 'id' field" },
    };
  }

  if (typeof obj.action !== "string") {
    return {
      id: obj.id,
      error: { code: "UNKNOWN_ACTION", message: "Missing or invalid 'action' field" },
    };
  }

  const validActions: Action[] = ["navigate", "click", "type", "screenshot", "read", "exec"];
  if (!(validActions as string[]).includes(obj.action)) {
    return {
      id: obj.id,
      error: { code: "UNKNOWN_ACTION", message: `Unknown action: "${obj.action}"` },
    };
  }

  return obj as unknown as Request;
}

/**
 * Serialize a Response for sending over WebSocket.
 * Uses JSON.stringify with error handling.
 */
function serializeResponse(resp: Response): string {
  try {
    return JSON.stringify(resp);
  } catch {
    return JSON.stringify({
      id: resp.id,
      error: { code: "UNKNOWN_ACTION", message: "Failed to serialize response" },
    });
  }
}

function sendResponse(resp: Response): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(serializeResponse(resp));
  } else {
    warn(`Cannot send response (id=${resp.id}) — WebSocket is not open (readyState=${ws?.readyState ?? "null"})`);
  }
}

// ── Action handlers ───────────────────────────────────────────────────────

async function handleScreenshot(
  id: string,
  params: ActionParams["screenshot"],
): Promise<Response> {
  const format = params?.format ?? "png";
  const quality = format === "jpeg" ? (params?.quality ?? 80) : undefined;
  const fullPage = params?.fullPage ?? false;

  try {
    // ── Block restricted URLs ─────────────────────────────────────────
    // Resolve the active tab to check the URL before even attempting capture.
    let resolvedTabId = activeTabId;
    if (resolvedTabId === null) {
      resolvedTabId = await getActiveTabId();
      activeTabId = resolvedTabId;
    }

    if (resolvedTabId !== null) {
      try {
        const tab = await chrome.tabs.get(resolvedTabId);
        if (tab.url && RESTRICTED_URL_RE.test(tab.url)) {
          return {
            id,
            error: {
              code: "RESTRICTED_URL",
              message: `Cannot capture screenshots of restricted pages: ${tab.url}`,
              suggestion:
                "Navigate to a regular web page (https://…) and try again.",
            },
          };
        }
      } catch {
        // Tab may no longer exist — proceed and let captureVisibleTab fail
        // naturally if the tab is gone.
      }
    }

    // ── Capture ───────────────────────────────────────────────────────
    const options: { format?: "png" | "jpeg"; quality?: number } = { format };
    if (quality !== undefined) {
      options.quality = quality;
    }

    const dataUrl: string = await chrome.tabs.captureVisibleTab(options);
    // Data URL format: "data:image/png;base64,…" — extract the raw base64.
    const base64 = dataUrl.split(",")[1] ?? dataUrl;

    // v1 limitation: fullPage only captures the visible viewport.
    const warning = fullPage
      ? "Full-page screenshot is viewport-only in v1. Only the visible viewport was captured. Use your own scrolling + stitching logic for true full-page captures."
      : undefined;

    return {
      id,
      result: {
        data: base64,
        format,
        ...(warning ? { warning } : {}),
      },
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);

    // Classify known Chrome extension errors.
    if (
      err.includes("Cannot access") ||
      err.includes("chrome://") ||
      err.includes("restricted") ||
      err.includes("not allowed")
    ) {
      return {
        id,
        error: {
          code: "RESTRICTED_URL",
          message: `Screenshot blocked — the page may be a restricted URL.`,
          suggestion:
            "Navigate to a regular web page (https://…) and try again.",
        },
      };
    }

    return {
      id,
      error: { code: "UNKNOWN_ACTION", message: `Screenshot failed: ${err}` },
    };
  }
}

// ── Navigate handler ───────────────────────────────────────────────────────

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
async function handleNavigate(
  id: string,
  params: ActionParams["navigate"],
): Promise<Response> {
  const url = params?.url;
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

  // ── Validate URL format ───────────────────────────────────────────────
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      id,
      error: {
        code: "INVALID_URL",
        message: `Invalid URL format: "${url}"`,
        suggestion:
          "Provide a fully-qualified URL like https://example.com",
      },
    };
  }

  // ── Block restricted schemes ──────────────────────────────────────────
  if (RESTRICTED_URL_RE.test(parsedUrl.href)) {
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

  const waitUntil = params?.waitUntil ?? "load";
  const timeoutMs = params?.timeout ?? 30000;

  // ── Resolve the active tab ────────────────────────────────────────────
  let tabId = activeTabId ?? (await getActiveTabId());
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

  // ── Detect same-page (hash-only) navigation ───────────────────────────
  // For hash-only changes, delegate to the content script so it can use
  // the full waitUntil event listeners without tab destruction.
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) {
      const currentUrl = new URL(tab.url);
      const isSamePage =
        parsedUrl.origin === currentUrl.origin &&
        parsedUrl.pathname === currentUrl.pathname &&
        parsedUrl.search === currentUrl.search;

      if (isSamePage) {
        // Forward to the content script for in-page handling.
        return forwardToContentScript(tabId, {
          id,
          action: "navigate",
          params: { url, waitUntil, timeout: timeoutMs },
        } as Request);
      }
    }
  } catch {
    // Tab may not exist — proceed with full navigation.
  }

  // ── Full cross-page navigation ────────────────────────────────────────
  //
  // NOTE (v1 limitation): waitForTabComplete only resolves on
  // status === "complete" (equivalent to waitUntil: "load"). The
  // domcontentloaded and networkidle strategies are only honoured
  // for same-page (hash-only) navigations. Cross-page navigations
  // always wait for window.onload.
  try {
    // Update the tab to the target URL.
    await chrome.tabs.update(tabId, { url: parsedUrl.href });

    // Wait for the tab to complete loading.
    await waitForTabComplete(tabId, timeoutMs);

    // The content script is auto-injected by the manifest. Give it a brief
    // moment to initialise, then query page info.
    await sleep(100);

    // Use the scripting API to extract page metadata.
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        url: window.location.href,
        title: document.title,
      }),
    });

    const pageInfo = results[0]?.result as
      | { url: string; title: string }
      | undefined;

    return {
      id,
      result: pageInfo ?? { url: parsedUrl.href, title: "" },
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);

    if (err.toLowerCase().includes("timeout") || err.toLowerCase().includes("timed out")) {
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

/**
 * Wait for a tab to reach `status: "complete"`.
 *
 * Uses `chrome.tabs.onUpdated` to detect when a specific tab finishes
 * loading. Times out after `timeoutMs`.
 */
function waitForTabComplete(
  tabId: number,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      chrome.tabs.onUpdated.removeListener(listener);
      reject(
        new Error(
          `Tab ${tabId} did not finish loading within ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    function listener(
      updatedTabId: number,
      changeInfo: chrome.tabs.OnUpdatedInfo,
    ) {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete") {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

/** Minimal sleep helper for the service worker. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Forward a request to the content script, with up to 2 retries on transient
 * failures (e.g. tab reload, content script re-injection).
 */
async function forwardToContentScript(
  tabId: number,
  request: Request,
  maxRetries = 2,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await ensureContentScript(tabId);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      if (attempt < maxRetries) {
        warn(`Content script not available, retrying (${attempt + 1}/${maxRetries})…`);
        await sleep(300);
        continue;
      }
      return {
        id: request.id,
        error: {
          code: "BROWSER_NOT_CONNECTED",
          message: err,
        },
      };
    }

    try {
      const TIMEOUT_MS = 30_000;
      const response: unknown = await Promise.race([
        chrome.tabs.sendMessage(tabId, request),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Request timed out")), TIMEOUT_MS),
        ),
      ]);

      if (response && typeof response === "object" && "id" in (response as object)) {
        return response as Response;
      }
      return {
        id: request.id,
        error: {
          code: "UNKNOWN_ACTION",
          message: "Invalid response from content script",
          suggestion:
            "The content script returned an unexpected response shape. Check the browser console for details.",
        },
      };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);

      // If the tab was closed, no point retrying.
      if (err.includes("Receiving end does not exist") || err.includes("closed")) {
        injectedTabs.delete(tabId);
        return {
          id: request.id,
          error: {
            code: "BROWSER_NOT_CONNECTED",
            message: `Tab ${tabId} was closed.`,
            suggestion: "Re-open the tab and navigate to the desired page.",
          },
        };
      }

      // Connection reset / port closed — retry if attempts remain.
      if (
        attempt < maxRetries &&
        (err.includes("Could not establish connection") ||
          err.includes("port") ||
          err.includes("timed out"))
      ) {
        warn(
          `Forward failed, retrying (${attempt + 1}/${maxRetries}): ${err}`,
        );
        injectedTabs.delete(tabId); // Force re-verification
        await sleep(300);
        continue;
      }

      return {
        id: request.id,
        error: {
          code: "UNKNOWN_ACTION",
          message: err,
          suggestion:
            "Check that the content script is loaded and the tab has a compatible page (not a restricted URL like chrome://).",
        },
      };
    }
  }

  // Should never reach here — all paths return above.
  return {
    id: request.id,
    error: {
      code: "UNKNOWN_ACTION",
      message: "Forward failed after all retries.",
    },
  };
}

async function handleIncomingMessage(raw: string): Promise<void> {
  // ── Respect the disabled flag ──────────────────────────────────────
  if (!enabled) {
    log("Bridge is disabled — ignoring incoming message");
    let id = "";
    try {
      const m = JSON.parse(raw);
      if (m && typeof m === "object" && typeof m.id === "string") id = m.id;
    } catch { /* use empty id */ }
    sendResponse({
      id,
      error: {
        code: "BROWSER_NOT_CONNECTED",
        message: "Bridge is disabled. Toggle 'Enable Bridge' in the extension popup to re-enable.",
      },
    });
    return;
  }

  log(`Received: ${raw.length > 200 ? raw.slice(0, 200) + "…" : raw}`);

  const parsed = parseRequest(raw);

  // If parseRequest returned an error Response, send it back immediately.
  if ("error" in parsed && parsed.id !== undefined) {
    sendResponse(parsed as Response);
    return;
  }

  const request = parsed as Request;

  // ── Navigate: handle directly (content script destroyed on navigation) ──
  if (request.action === "navigate") {
    const resp = await handleNavigate(request.id, request.params as ActionParams["navigate"]);
    sendResponse(resp);
    return;
  }

  // ── Screenshot: handle directly (no content script needed) ──────────
  if (request.action === "screenshot") {
    const resp = await handleScreenshot(request.id, request.params as ActionParams["screenshot"]);
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
      // Malformed URL — let the content script handle the error.
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

  // ── All other actions: forward to content script ────────────────────
  if (activeTabId === null) {
    activeTabId = await getActiveTabId();
  }

  if (activeTabId === null) {
    sendResponse({
      id: request.id,
      error: { code: "BROWSER_NOT_CONNECTED", message: "No active tab available" },
    });
    return;
  }

  const resp = await forwardToContentScript(activeTabId, request);
  sendResponse(resp);
}

// ── Tab lifecycle ─────────────────────────────────────────────────────────

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tabId = activeInfo.tabId;
  log(`Active tab changed to ${tabId}`);
  activeTabId = tabId;
  // Re-verify content script presence on the new tab.
  // We don't block here — the next request will trigger ensureContentScript.
});

// Track removed tabs to clean up our injection set.
chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
  if (activeTabId === tabId) {
    activeTabId = null;
  }
});

// Listen for ping responses from the content script.
// The content script calls chrome.runtime.sendMessage in response to our
// sendMessage call. Actually, since sendMessage already returns a promise
// with the response, this listener is for async messages from the content
// script (e.g. unsolicited updates). For now, the request/response cycle
// is handled via the sendMessage return value.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Handle ping acknowledgment separately if needed.
  if (message && typeof message === "object" && (message as Record<string, unknown>).type === "pong") {
    // The content script acknowledged our ping — already tracked in ensureContentScript.
    // No action needed here since the Promise returned by sendMessage handles this.
    // We must call sendResponse() to keep the port open in MV3 if we return true.
    sendResponse({ type: "ack" });
  }
  // Return false — we are not sending an async response here.
  return false;
});

// ── Storage change listener (enabled flag updates from popup) ────────────

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  const change = changes[STORAGE_KEY];
  if (!change) return;
  const state = change.newValue as Record<string, unknown> | undefined;
  if (state && typeof state === "object" && "enabled" in state) {
    const val = state.enabled;
    if (typeof val === "boolean") {
      enabled = val;
      log(`Bridge ${enabled ? "enabled" : "disabled"} (from storage change)`);
    }
  }
});

// ── Startup ───────────────────────────────────────────────────────────────

/** Set up the default domain allowlist on first install / update. */
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const stored = (await chrome.storage.local.get(ALLOWLIST_KEY)) as Record<string, unknown>;
    if (stored[ALLOWLIST_KEY] === undefined) {
      await chrome.storage.local.set({ [ALLOWLIST_KEY]: DEFAULT_ALLOWLIST });
      log(`Initialised default domain allowlist: ["*"] (allow all)`);
    }
  } catch (e) {
    warn(`Failed to initialise allowlist: ${e}`);
  }
});

async function init(): Promise<void> {
  log("Background service worker started");

  // ── Read enabled flag ────────────────────────────────────────────
  try {
    const stored = (await chrome.storage.local.get(STORAGE_KEY)) as Record<string, unknown>;
    const cfg = stored[STORAGE_KEY];
    if (cfg && typeof cfg === "object" && "enabled" in cfg) {
      const val = (cfg as Record<string, unknown>).enabled;
      if (typeof val === "boolean") enabled = val;
      log(`Bridge ${enabled ? "enabled" : "disabled"} (from storage)`);
    }
  } catch (e) {
    warn(`Failed to read enabled flag from storage: ${e}`);
  }

  // ── Ensure allowlist exists (worker may restart without onInstalled) ──
  try {
    const stored = (await chrome.storage.local.get(ALLOWLIST_KEY)) as Record<string, unknown>;
    if (stored[ALLOWLIST_KEY] === undefined) {
      await chrome.storage.local.set({ [ALLOWLIST_KEY]: DEFAULT_ALLOWLIST });
    }
  } catch {
    // Non-critical.
  }

  port = await loadPort();
  activeTabId = await getActiveTabId();
  if (activeTabId !== null) {
    log(`Initial active tab: ${activeTabId}`);
  } else {
    warn("No active tab found on startup");
  }

  connect();
}

void init();

// Export for testing or external access.
export { connect, getActiveTabId, loadPort, savePort };
