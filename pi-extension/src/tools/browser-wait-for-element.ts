/**
 * browser_wait_for_element tool — pi-side handler.
 *
 * Sends a `waitForElement` request through the WebSocket bridge to the
 * Chrome extension's content script, which polls the DOM for the given
 * CSS selector and returns timing metadata once the element appears.
 *
 * @module tools/browser-wait-for-element
 */

import type {
  ErrorResponse,
  Response,
  WaitForElementParams,
} from "@pi-browser-bridge/protocol";
import { send } from "../server.js";

// ── Types ──────────────────────────────────────────────────────────────────

/** Validated parameters for the `browser_wait_for_element` tool. */
export interface BrowserWaitForElementParams {
  /** Target tab ID. When omitted, defaults to the active tab. */
  tabId?: number;
  /** CSS selector of the element to wait for. */
  selector: string;
  /** Maximum time to wait (ms). @default 10000 */
  timeout?: number;
}

/** Shape of a successful wait result. */
interface WaitForElementSuccess {
  found: true;
  elapsedMs: number;
  selector: string;
  tagName: string;
}

/** Shape of a timeout result. */
interface WaitForElementTimeout {
  found: false;
  elapsedMs: number;
  selector: string;
  error: "TIMEOUT";
  message: string;
}

/** Union of possible outcomes. */
type WaitForElementResult = WaitForElementSuccess | WaitForElementTimeout;

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

export const BROWSER_WAIT_FOR_ELEMENT_SCHEMA = {
  type: "object",
  properties: {
    tabId: {
      type: "integer",
      description: "Target tab ID. When omitted, defaults to the active tab.",
    },
    selector: {
      type: "string",
      description: "CSS selector of the element to wait for.",
    },
    timeout: {
      type: "integer",
      minimum: 0,
      default: 10000,
      description: "Maximum time to wait for the element (ms).",
    },
  },
  required: ["selector"],
} as const;

// ── Validation ─────────────────────────────────────────────────────────────

function validateParams(raw: unknown): raw is BrowserWaitForElementParams {
  if (typeof raw !== "object" || raw === null) return false;
  const p = raw as Record<string, unknown>;

  if (p.tabId !== undefined && (typeof p.tabId !== "number" || !Number.isInteger(p.tabId))) return false;

  if (typeof p.selector !== "string" || p.selector.length === 0) return false;

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
 * Wait for an element matching a CSS selector to appear in the DOM.
 *
 * Delegates polling to the Chrome extension content script via the
 * WebSocket bridge. Returns timing info when found or TIMEOUT when
 * the element does not appear within the timeout.
 */
export async function browserWaitForElement(
  params: BrowserWaitForElementParams,
): Promise<ToolResult> {
  // ── Validate ──────────────────────────────────────────────────────────
  if (!validateParams(params)) {
    return errorResult(
      "Invalid wait_for_element parameters. Expected: selector (string, required), timeout (integer ms, default 10000).",
    );
  }

  const timeout = params.timeout ?? 10000;

  // ── Send request via WebSocket bridge ─────────────────────────────────
  let response: Response<"waitForElement">;
  try {
    response = await send<"waitForElement">({
      id: crypto.randomUUID(),
      action: "waitForElement",
      params: {
        tabId: params.tabId,
        selector: params.selector,
        timeout,
      } satisfies WaitForElementParams,
    });
  } catch (err) {
    const e = err as ErrorResponse;
    const msg = [`Wait request failed: ${e.message ?? String(err)}`];
    if (e.suggestion) msg.push(e.suggestion);
    return errorResult(msg.join("\n"));
  }

  // ── Handle browser-reported error ─────────────────────────────────────
  if (response.error) {
    const { code, message, suggestion } = response.error;
    const lines = [`Wait failed: ${message}`];
    if (code === "TIMEOUT") {
      lines.push(
        `Element "${params.selector}" did not appear within ${timeout}ms.`,
      );
    }
    if (suggestion) lines.push(suggestion);
    return errorResult(lines.join("\n"));
  }

  // ── Extract result ────────────────────────────────────────────────────
  const result = response.result as WaitForElementResult | undefined;
  if (!result) {
    return errorResult("Wait returned no result.");
  }

  if (!result.found) {
    return errorResult(
      `Element "${params.selector}" not found within ${result.elapsedMs}ms.`,
    );
  }

  return {
    content: [
      textBlock(
        `Element "${result.selector}" (<${result.tagName}>) found in ${result.elapsedMs}ms.`,
      ),
    ],
  };
}

// ── Tool registration shape ────────────────────────────────────────────────

/**
 * Pi-compatible tool definition.
 *
 * Import and register this in the extension entry-point to expose the
 * `browser_wait_for_element` tool to the agent.
 */
export const browserWaitForElementTool = {
  name: "browser_wait_for_element",
  description:
    "Wait for an element matching a CSS selector to appear in the DOM. Optionally target a specific tab via tabId; when omitted, defaults to the active tab. Uses MutationObserver + polling for efficiency. Returns the element's tag name and time elapsed when found, or TIMEOUT if the element doesn't appear within the deadline.",
  schema: BROWSER_WAIT_FOR_ELEMENT_SCHEMA,
  execute: browserWaitForElement,
} as const;
