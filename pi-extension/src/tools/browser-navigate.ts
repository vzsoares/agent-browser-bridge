/**
 * browser_navigate tool — pi-side handler.
 *
 * Sends a navigate request through the WebSocket bridge to the Chrome
 * extension's service worker, which performs the actual tab navigation
 * and returns the resulting page URL and title.
 *
 * @module tools/browser-navigate
 */

import type {
  ErrorResponse,
  NavigateParams,
  Response,
} from "@pi-browser-bridge/protocol";
import { send } from "../server.js";

// ── Types ──────────────────────────────────────────────────────────────────

/** Validated parameters for the `browser_navigate` tool. */
export interface BrowserNavigateParams {
  /** Fully-qualified URL to navigate to. */
  url: string;
  /**
   * When to consider navigation complete.
   * @default "load"
   */
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  /** Maximum time to wait in ms. @default 30000 */
  timeout?: number;
}

/** Shape of the navigate result payload returned by the service worker. */
interface NavigateResult {
  url: string;
  title: string;
}

/** A pi-compatible text content block. */
interface TextContentBlock {
  type: "text";
  text: string;
}

/** Standardised return shape for pi tools. */
interface ToolResult {
  content: TextContentBlock[];
  /** When true the result represents an error the agent should surface. */
  isError?: boolean;
}

// ── Restricted URL patterns ────────────────────────────────────────────────

/**
 * URL schemes that are blocked from navigation.
 * Mirrors the regex in the Chrome extension's service worker.
 */
const RESTRICTED_URL_RE = /^(chrome|chrome-extension|edge|brave|about):\/\//i;

// ── Schema (JSON Schema compatible) ────────────────────────────────────────

export const BROWSER_NAVIGATE_SCHEMA = {
  type: "object",
  properties: {
    url: {
      type: "string",
      description: "Fully-qualified URL to navigate to (e.g. https://example.com).",
    },
    waitUntil: {
      type: "string",
      enum: ["load", "domcontentloaded", "networkidle"],
      default: "load",
      description:
        "When to consider navigation complete. 'load' waits for the window.load event. " +
        "'domcontentloaded' and 'networkidle' are currently approximated as 'load' in v1.",
    },
    timeout: {
      type: "integer",
      minimum: 1000,
      default: 30000,
      description:
        "Maximum time to wait for navigation in milliseconds. Defaults to 30000 (30s).",
    },
  },
  required: ["url"],
} as const;

// ── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate raw parameters against the `BrowserNavigateParams` shape.
 * Does NOT validate the URL itself — that's done separately so we can
 * return specific error codes.
 */
function validateParams(raw: unknown): raw is BrowserNavigateParams {
  if (typeof raw !== "object" || raw === null) return false;
  const p = raw as Record<string, unknown>;

  if (typeof p.url !== "string" || p.url.length === 0) return false;

  if (
    p.waitUntil !== undefined &&
    !["load", "domcontentloaded", "networkidle"].includes(p.waitUntil as string)
  ) {
    return false;
  }

  if (
    p.timeout !== undefined &&
    (typeof p.timeout !== "number" ||
      !Number.isInteger(p.timeout) ||
      p.timeout < 1)
  ) {
    return false;
  }

  return true;
}

/**
 * Validate a URL string against format and security constraints.
 *
 * @returns `null` if valid, or an error descriptor with the appropriate code.
 */
function validateUrl(
  url: string,
): { valid: true } | { valid: false; code: "INVALID_URL" | "RESTRICTED_URL"; message: string; suggestion?: string } {
  // ── Format check ──────────────────────────────────────────────────────
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      valid: false,
      code: "INVALID_URL",
      message: `Invalid URL format: "${url}"`,
      suggestion:
        "Provide a fully-qualified URL like https://example.com or https://example.com/path.",
    };
  }

  // ── Scheme restrictions ───────────────────────────────────────────────
  if (RESTRICTED_URL_RE.test(parsed.href)) {
    const scheme = parsed.protocol.replace(/:$/, "");
    return {
      valid: false,
      code: "RESTRICTED_URL",
      message: `Navigation to "${scheme}://" URLs is blocked for security reasons.`,
      suggestion: "Use https:// URLs for web pages.",
    };
  }

  return { valid: true };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function textBlock(text: string): TextContentBlock {
  return { type: "text", text };
}

function errorResult(message: string): ToolResult {
  return { content: [textBlock(message)], isError: true };
}

// ── Handler ────────────────────────────────────────────────────────────────

/**
 * Navigate the active browser tab to a URL.
 *
 * Delegates the actual navigation to the Chrome extension service worker via
 * the WebSocket bridge. The service worker uses `chrome.tabs.update` to
 * perform the navigation, waits for the page to load, and returns the final
 * URL (after redirects) and page title.
 */
export async function browserNavigate(
  params: BrowserNavigateParams,
): Promise<ToolResult> {
  // ── Validate params shape ─────────────────────────────────────────────
  if (!validateParams(params)) {
    return errorResult(
      "Invalid navigate parameters. Expected: url (string, required), " +
        "waitUntil ('load' | 'domcontentloaded' | 'networkidle', default 'load'), " +
        "timeout (integer ms, default 30000).",
    );
  }

  // ── Validate URL ──────────────────────────────────────────────────────
  const urlCheck = validateUrl(params.url);
  if (!urlCheck.valid) {
    const lines = [urlCheck.message];
    if (urlCheck.suggestion) lines.push(urlCheck.suggestion);
    return errorResult(lines.join("\n"));
  }

  const waitUntil = params.waitUntil ?? "load";
  const timeout = params.timeout ?? 30000;

  // ── Send request via WebSocket bridge ─────────────────────────────────
  let response: Response<"navigate">;
  try {
    response = await send<"navigate">({
      id: crypto.randomUUID(),
      action: "navigate",
      params: {
        url: params.url,
        waitUntil,
        timeout,
      } satisfies NavigateParams,
    });
  } catch (err) {
    const e = err as ErrorResponse;
    const msg = [`Navigate request failed: ${e.message ?? String(err)}`];
    if (e.suggestion) msg.push(e.suggestion);
    return errorResult(msg.join("\n"));
  }

  // ── Handle browser-reported error ─────────────────────────────────────
  if (response.error) {
    const { code, message, suggestion } = response.error;
    const lines = [`Navigate failed: ${message}`];
    if (code === "RESTRICTED_URL") {
      lines.push(
        "Cannot navigate to chrome://, edge://, or other restricted pages.",
      );
    }
    if (code === "TIMEOUT") {
      lines.push(
        `The page took longer than ${timeout}ms to load. Try increasing the timeout or check the URL.`,
      );
    }
    if (code === "BROWSER_NOT_CONNECTED") {
      lines.push(
        "No browser extension is connected. Make sure the Pi Browser Bridge extension is installed and active.",
      );
    }
    if (suggestion) lines.push(suggestion);
    return errorResult(lines.join("\n"));
  }

  // ── Extract result ────────────────────────────────────────────────────
  const result = response.result as NavigateResult | undefined;
  if (!result) {
    return errorResult("Navigate completed but returned no result.");
  }

  // ── Build text response ───────────────────────────────────────────────
  return {
    content: [
      textBlock(
        `Navigated to: ${result.url}\nPage title: ${result.title || "(no title)"}`,
      ),
    ],
  };
}

// ── Tool registration shape ────────────────────────────────────────────────

/**
 * Pi-compatible tool definition.
 *
 * Import and register this in the extension entry-point to expose the
 * `browser_navigate` tool to the agent.
 */
export const browserNavigateTool = {
  name: "browser_navigate",
  description:
    "Navigate the active browser tab to a URL. Returns the final URL after redirects and the page title. " +
    "Supports configurable wait strategies: 'load' (default), 'domcontentloaded', and 'networkidle' (v1 approximation).",
  schema: BROWSER_NAVIGATE_SCHEMA,
  execute: browserNavigate,
} as const;
