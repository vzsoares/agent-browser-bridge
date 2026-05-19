/**
 * Shared WebSocket protocol types for the agent-browser-bridge.
 *
 * This package is types-only — it has zero runtime dependencies and can be
 * imported by both the pi-extension (Bun) and the chrome-extension (browser).
 *
 * @module protocol
 */

// ── Action names ────────────────────────────────────────────────────────────

/**
 * All recognised browser-automation actions.
 * Extend this union when adding new tools.
 */
export type Action =
	| "navigate"
	| "click"
	| "type"
	| "screenshot"
	| "read"
	| "exec"
	| "waitForElement"
	| "waitForText"
	| "createTab"
	| "listTabs"
	| "closeTab";

// ── Error codes ─────────────────────────────────────────────────────────────

/**
 * Standardised error codes returned by the browser agent.
 * Each code maps to a well-known failure mode so clients can react
 * programmatically (e.g. retry on TIMEOUT, warn on RESTRICTED_URL).
 *
 * | Code | Meaning | Suggestion |
 * |------|---------|------------|
 * | `TIMEOUT` | Request took longer than the configured timeout. | Increase the timeout or check the page is loaded. |
 * | `ELEMENT_NOT_FOUND` | No element matching the CSS selector was found in the DOM. | Check the selector; the page may not have rendered yet. |
 * | `ELEMENT_NOT_INTERACTABLE` | The element exists but is hidden, disabled, or read-only. | Wait for the element to become visible, or use a different selector. |
 * | `ELEMENT_NOT_TYPABLE` | The element is not an input, textarea, or contenteditable element. | Use a selector that targets a typable element. |
 * | `INVALID_URL` | The provided URL is malformed or missing. | Provide a fully-qualified URL like `https://example.com`. |
 * | `RESTRICTED_URL` | The URL uses a blocked scheme (chrome://, edge://, about://, etc.). | Use `https://` URLs for web pages. |
 * | `RESTRICTED_DOMAIN` | The current page's domain is not in the configured allowlist. | Add the domain to the allowlist in the extension popup or set the allowlist to `*` to allow all. |
 * | `BROWSER_NOT_CONNECTED` | No Chrome extension is connected to the WebSocket server. | Install and enable the Agent Browser Bridge Chrome extension. |
 * | `CONNECTION_RESET` | The WebSocket connection was lost during a request. | The bridge retries automatically. If it persists, restart the extension. |
 * | `UNKNOWN_ACTION` | The requested action is not recognised, or the request was malformed. | Check the action name against the supported actions: navigate, click, type, screenshot, read, exec. |
 * | `TAB_NOT_FOUND` | The specified tabId does not correspond to any open tab. | The tab may have been closed. List tabs to find a valid tabId. |
 */
export type ErrorCode =
	| "TIMEOUT"
	| "ELEMENT_NOT_FOUND"
	| "ELEMENT_NOT_INTERACTABLE"
	| "ELEMENT_NOT_TYPABLE"
	| "INVALID_URL"
	| "RESTRICTED_URL"
	| "RESTRICTED_DOMAIN"
	| "BROWSER_NOT_CONNECTED"
	| "CONNECTION_RESET"
	| "UNKNOWN_ACTION"
	| "TAB_NOT_FOUND";

// ── Error response ──────────────────────────────────────────────────────────

/**
 * Structured error payload carried inside a {@link Response}.
 */
export interface ErrorResponse {
	/** Machine-readable error code (see {@link ErrorCode}). */
	code: ErrorCode;
	/** Human-readable description of what went wrong. */
	message: string;
	/** Optional hint steering the caller toward a fix. */
	suggestion?: string;
}

// ── Tool parameter interfaces ───────────────────────────────────────────────

/** Parameters for the `navigate` action. */
export interface NavigateParams {
	/** Target tab ID. When omitted, defaults to the active tab or creates a new tab. */
	tabId?: number;
	/** Fully-qualified URL to navigate to. */
	url: string;
	/**
	 * When to consider navigation complete.
	 * @default "load"
	 */
	waitUntil?: "load" | "domcontentloaded" | "networkidle";
	/** Maximum time to wait (ms). No limit when omitted. */
	timeout?: number;
}

/** Parameters for the `screenshot` action. */
export interface ScreenshotParams {
	/** Target tab ID. Defaults to the active tab when omitted. */
	tabId?: number;
	/** Image format. @default "png" */
	format?: "png" | "jpeg";
	/** JPEG quality (0–100). Only meaningful when format is `"jpeg"`. */
	quality?: number;
	/** Capture the full scrollable page instead of just the viewport. @default false */
	fullPage?: boolean;
}

/** Parameters for the `read` action. */
export interface ReadParams {
	/** Target tab ID. Defaults to the active tab when omitted. */
	tabId?: number;
	/** CSS selector scoping the read. Defaults to `body` when omitted. */
	selector?: string;
	/** Truncate returned text to this many characters. */
	maxLength?: number;
}

/** Parameters for the `click` action. */
export interface ClickParams {
	/** Target tab ID. Defaults to the active tab when omitted. */
	tabId?: number;
	/** CSS selector of the element to click. */
	selector: string;
	/** Optional text content the element must contain (for disambiguation). */
	text?: string;
	/** Maximum time to wait for the element (ms). */
	timeout?: number;
}

/** Parameters for the `type` action. */
export interface TypeParams {
	/** Target tab ID. Defaults to the active tab when omitted. */
	tabId?: number;
	/** CSS selector of the input element. */
	selector: string;
	/** Text to type into the element. */
	text: string;
	/** Clear existing value before typing. @default true */
	clear?: boolean;
	/** Press Enter after typing (submit surrounding form). @default false */
	submit?: boolean;
	/** Maximum time to wait for the element (ms). */
	timeout?: number;
}

/** Parameters for the `exec` action. */
export interface ExecParams {
	/** Target tab ID. Defaults to the active tab when omitted. */
	tabId?: number;
	/** JavaScript code to evaluate in the page context. */
	code: string;
}

/** Result returned by the `exec` action. */
export interface ExecResult {
	/** Raw return value (unserialised — may contain non-transferable types). */
	value: unknown;
	/** Human-readable serialised representation safe for display. */
	serialized: string;
}

/** Parameters for the `waitForElement` action. */
export interface WaitForElementParams {
	/** Target tab ID. Defaults to the active tab when omitted. */
	tabId?: number;
	/** CSS selector of the element to wait for. */
	selector: string;
	/** Maximum time to wait for the element (ms). @default 10000 */
	timeout?: number;
}

/** Parameters for the `waitForText` action. */
export interface WaitForTextParams {
	/** Target tab ID. Defaults to the active tab when omitted. */
	tabId?: number;
	/** Case-sensitive text to wait for. */
	text: string;
	/** Optional CSS selector to limit the search scope. */
	scope?: string;
	/** Maximum time to wait for the text (ms). @default 10000 */
	timeout?: number;
}

/** Parameters for the `createTab` action. */
export interface CreateTabParams {
	/** URL to open in the new tab. */
	url?: string;
	/** Whether the new tab should become the active tab. @default true */
	active?: boolean;
}

/** Parameters for the `listTabs` action. */
export interface ListTabsParams {
	/** Filter tabs by URL substring match. */
	urlPattern?: string;
	/** Only list tabs in the current window. @default true */
	currentWindowOnly?: boolean;
}

/** Parameters for the `closeTab` action. */
export interface CloseTabParams {
	/** ID of the tab to close. */
	tabId: number;
}

// ── Action-to-params mapping ────────────────────────────────────────────────

/**
 * Maps each {@link Action} to its corresponding params interface.
 * Used internally by {@link Request} to keep the `params` field type-safe.
 */
export interface ActionParams {
	navigate: NavigateParams;
	click: ClickParams;
	type: TypeParams;
	screenshot: ScreenshotParams;
	read: ReadParams;
	exec: ExecParams;
	waitForElement: WaitForElementParams;
	waitForText: WaitForTextParams;
	createTab: CreateTabParams;
	listTabs: ListTabsParams;
	closeTab: CloseTabParams;
}

// ── Request / Response ──────────────────────────────────────────────────────

/**
 * Outgoing message from client → browser agent.
 *
 * @typeParam A — Concrete action. Defaults to the full {@link Action} union so
 *               untyped callers can still construct a valid request.
 *
 * @example
 * ```ts
 * const req: Request<"navigate"> = {
 *   id: "1",
 *   action: "navigate",
 *   params: { url: "https://example.com" },
 * };
 * ```
 */
export interface Request<A extends Action = Action> {
	/** Unique correlation id echoed back in the {@link Response}. */
	id: string;
	/** Which browser-automation action to perform. */
	action: A;
	/** Action-specific parameters (type-safe when `A` is a literal). */
	params: ActionParams[A];
}

/**
 * Incoming message from browser agent → client.
 *
 * Exactly one of `result` or `error` will be populated for a given `id`.
 *
 * @typeParam A — Concrete action. Defaults to the full {@link Action} union.
 */
export interface Response<_A extends Action = Action> {
	/** Correlation id matching the originating {@link Request}. */
	id: string;
	/** Action result payload (shape depends on `action`). */
	result?: unknown;
	/** Structured error when the action failed. */
	error?: ErrorResponse;
}
