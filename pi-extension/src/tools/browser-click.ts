/**
 * browser_click tool — pi-side handler.
 *
 * Sends a click request through the WebSocket bridge to the Chrome
 * extension's content script, which locates the element, validates it
 * is interactable, clicks it, and reports back what happened.
 *
 * @module tools/browser-click
 */

import type { ClickParams, ErrorResponse, Response } from "@pi-browser-bridge/protocol";
import { send } from "../server.js";

// ── Types ──────────────────────────────────────────────────────────────────

/** Validated parameters for the `browser_click` tool. */
export interface BrowserClickParams {
  /** Target tab ID. When omitted, defaults to the active tab. */
  tabId?: number;
  /** CSS selector of the element to click. */
  selector: string;
  /** Optional text content the element must contain (for disambiguation). */
  text?: string;
  /** Maximum time to wait for the element (ms). @default 10000 */
  timeout?: number;
}

/** Shape of a successful click result returned by the content script. */
interface ClickSuccessResult {
  clicked: true;
  selector: string;
  /** The trimmed text content of the clicked element. */
  text: string;
  /** Whether the page navigated after the click. */
  navigated: boolean;
  /** New document title (only when navigated). */
  newTitle?: string;
  /** New document URL (only when navigated). */
  newUrl?: string;
}

/** Shape of a click failure result returned by the content script. */
interface ClickErrorResult {
  clicked: false;
  code: string;
  message: string;
  /** Optional list of matching element text contents as suggestions. */
  suggestions?: string[];
}

/** Union of possible click outcomes from the content script. */
type ClickResult = ClickSuccessResult | ClickErrorResult;

/** A pi-compatible text content block. */
interface TextContentBlock {
  type: "text";
  text: string;
}

/** Standardised return shape for pi tools. */
interface ToolResult {
  content: TextContentBlock[];
  isError?: boolean;
}

// ── Schema (JSON Schema compatible) ────────────────────────────────────────

export const BROWSER_CLICK_SCHEMA = {
  type: "object",
  properties: {
    tabId: {
      type: "integer",
      description: "Target tab ID. When omitted, defaults to the active tab.",
    },
    selector: {
      type: "string",
      description: "CSS selector of the element to click.",
    },
    text: {
      type: "string",
      description:
        "Optional text content the element must contain. When provided, the first element matching `selector` whose textContent includes this value (case-insensitive, trimmed) is clicked. Useful for disambiguating multiple matches.",
    },
    timeout: {
      type: "integer",
      minimum: 0,
      default: 10000,
      description: "Maximum time to wait for the element to appear (ms).",
    },
  },
  required: ["selector"],
} as const;

// ── Validation ─────────────────────────────────────────────────────────────

function validateParams(raw: unknown): raw is BrowserClickParams {
  if (typeof raw !== "object" || raw === null) return false;
  const p = raw as Record<string, unknown>;

  if (p.tabId !== undefined && (typeof p.tabId !== "number" || !Number.isInteger(p.tabId))) return false;

  if (typeof p.selector !== "string" || p.selector.length === 0) return false;

  if (p.text !== undefined && typeof p.text !== "string") return false;

  if (
    p.timeout !== undefined &&
    (typeof p.timeout !== "number" ||
      !Number.isInteger(p.timeout) ||
      p.timeout < 0)
  ) {
    return false;
  }

  return true;
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
 * Click an element in the current browser tab.
 *
 * Delegates element resolution, validation, and clicking to the Chrome
 * extension content script via the WebSocket bridge.
 */
export async function browserClick(
  params: BrowserClickParams,
): Promise<ToolResult> {
  // ── Validate ──────────────────────────────────────────────────────────
  if (!validateParams(params)) {
    return errorResult(
      "Invalid click parameters. Expected: selector (string, required), text (string, optional), timeout (integer ms, default 10000).",
    );
  }

  const timeout = params.timeout ?? 10000;

  // ── Send request via WebSocket bridge ─────────────────────────────────
  let response: Response<"click">;
  try {
    response = await send<"click">({
      id: crypto.randomUUID(),
      action: "click",
      params: {
        tabId: params.tabId,
        selector: params.selector,
        text: params.text,
        timeout,
      } satisfies ClickParams,
    });
  } catch (err) {
    const e = err as ErrorResponse;
    const msg = [`Click request failed: ${e.message ?? String(err)}`];
    if (e.suggestion) msg.push(e.suggestion);
    return errorResult(msg.join("\n"));
  }

  // ── Handle browser-reported error ─────────────────────────────────────
  if (response.error) {
    const { code, message, suggestion } = response.error;
    const lines = [`Click failed: ${message}`];
    if (code === "ELEMENT_NOT_FOUND") {
      lines.push(
        "The element was not found on the page. Check the selector and try again.",
      );
    }
    if (code === "ELEMENT_NOT_INTERACTABLE") {
      lines.push(
        "The element exists but cannot be interacted with (hidden or disabled).",
      );
    }
    if (code === "TIMEOUT") {
      lines.push(
        `The click request timed out after ${timeout}ms. The element may have not appeared in time.`,
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
  const result = response.result as ClickResult | undefined;
  if (!result) {
    return errorResult("Click returned no result.");
  }

  // ── Handle content-script-level failure ───────────────────────────────
  if (!result.clicked) {
    const { code, message, suggestions } = result as ClickErrorResult;
    const lines = [`Click failed: ${message}`];

    if (code === "ELEMENT_NOT_FOUND" && suggestions && suggestions.length > 0) {
      lines.push(
        "",
        `Elements matching selector "${params.selector}" on the page:`,
        ...suggestions.map((s, i) => `  ${i + 1}. "${s}"`),
      );
    } else if (code === "ELEMENT_NOT_INTERACTABLE") {
      lines.push(
        "The element exists but is hidden or disabled and cannot be clicked.",
      );
    }

    return errorResult(lines.join("\n"));
  }

  // ── Build success text ────────────────────────────────────────────────
  const success = result as ClickSuccessResult;
  const lines: string[] = [
    `Clicked element "${success.selector}"`,
    `Element text: "${success.text}"`,
  ];

  if (success.navigated) {
    lines.push(
      `Navigation occurred after click.`,
      `New title: ${success.newTitle ?? "(unknown)"}`,
      `New URL: ${success.newUrl ?? "(unknown)"}`,
    );
  }

  return { content: [textBlock(lines.join("\n"))] };
}

// ── Tool registration shape ────────────────────────────────────────────────

/**
 * Pi-compatible tool definition.
 *
 * Import and register this in the extension entry-point to expose the
 * `browser_click` tool to the agent.
 */
export const browserClickTool = {
  name: "browser_click",
  description:
    "Click an element on the browser page by CSS selector. Optionally target a specific tab via tabId; when omitted, defaults to the active tab. Optionally disambiguate by text content. Reports the clicked element's text and whether navigation occurred after the click.",
  schema: BROWSER_CLICK_SCHEMA,
  execute: browserClick,
} as const;
