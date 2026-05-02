/**
 * browser_wait_for_text tool — pi-side handler.
 *
 * Sends a `waitForText` request through the WebSocket bridge to the
 * Chrome extension's content script, which polls the DOM for the given
 * text content and returns timing metadata once it appears.
 *
 * @module tools/browser-wait-for-text
 */

import type {
  ErrorResponse,
  Response,
  WaitForTextParams,
} from "@pi-browser-bridge/protocol";
import { send } from "../server.js";

// ── Types ──────────────────────────────────────────────────────────────────

/** Validated parameters for the `browser_wait_for_text` tool. */
export interface BrowserWaitForTextParams {
  /** Case-sensitive text to wait for. */
  text: string;
  /** Optional CSS selector to limit the search scope. */
  scope?: string;
  /** Maximum time to wait (ms). @default 10000 */
  timeout?: number;
}

/** Shape of a successful wait result. */
interface WaitForTextSuccess {
  found: true;
  elapsedMs: number;
  text: string;
}

/** Shape of a timeout result. */
interface WaitForTextTimeout {
  found: false;
  elapsedMs: number;
  text: string;
  error: "TIMEOUT";
  message: string;
}

/** Union of possible outcomes. */
type WaitForTextResult = WaitForTextSuccess | WaitForTextTimeout;

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

export const BROWSER_WAIT_FOR_TEXT_SCHEMA = {
  type: "object",
  properties: {
    text: {
      type: "string",
      description: "Case-sensitive text content to wait for.",
    },
    scope: {
      type: "string",
      description:
        "Optional CSS selector to limit the search scope. When omitted, the entire page body is searched.",
    },
    timeout: {
      type: "integer",
      minimum: 0,
      default: 10000,
      description: "Maximum time to wait for the text (ms).",
    },
  },
  required: ["text"],
} as const;

// ── Validation ─────────────────────────────────────────────────────────────

function validateParams(raw: unknown): raw is BrowserWaitForTextParams {
  if (typeof raw !== "object" || raw === null) return false;
  const p = raw as Record<string, unknown>;

  if (typeof p.text !== "string" || p.text.length === 0) return false;

  if (p.scope !== undefined && typeof p.scope !== "string") return false;

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
 * Wait for specific text content to appear on the page.
 *
 * Delegates polling to the Chrome extension content script via the
 * WebSocket bridge. Returns timing info when found or TIMEOUT when
 * the text does not appear within the timeout.
 */
export async function browserWaitForText(
  params: BrowserWaitForTextParams,
): Promise<ToolResult> {
  // ── Validate ──────────────────────────────────────────────────────────
  if (!validateParams(params)) {
    return errorResult(
      "Invalid wait_for_text parameters. Expected: text (string, required), scope (string, optional), timeout (integer ms, default 10000).",
    );
  }

  const timeout = params.timeout ?? 10000;
  const scopeLabel = params.scope ? ` within "${params.scope}"` : "";

  // ── Send request via WebSocket bridge ─────────────────────────────────
  let response: Response<"waitForText">;
  try {
    response = await send<"waitForText">({
      id: crypto.randomUUID(),
      action: "waitForText",
      params: {
        text: params.text,
        scope: params.scope,
        timeout,
      } satisfies WaitForTextParams,
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
        `Text "${params.text}" did not appear${scopeLabel} within ${timeout}ms.`,
      );
    }
    if (suggestion) lines.push(suggestion);
    return errorResult(lines.join("\n"));
  }

  // ── Extract result ────────────────────────────────────────────────────
  const result = response.result as WaitForTextResult | undefined;
  if (!result) {
    return errorResult("Wait returned no result.");
  }

  if (!result.found) {
    return errorResult(
      `Text "${params.text}" not found${scopeLabel} within ${result.elapsedMs}ms.`,
    );
  }

  return {
    content: [
      textBlock(
        `Text "${result.text}" found${scopeLabel} in ${result.elapsedMs}ms.`,
      ),
    ],
  };
}

// ── Tool registration shape ────────────────────────────────────────────────

/**
 * Pi-compatible tool definition.
 *
 * Import and register this in the extension entry-point to expose the
 * `browser_wait_for_text` tool to the agent.
 */
export const browserWaitForTextTool = {
  name: "browser_wait_for_text",
  description:
    "Wait for specific text content to appear on the page. Optionally scope the search to a CSS selector. Polls every 100ms until the text is found or timeout. Returns the elapsed time when found.",
  schema: BROWSER_WAIT_FOR_TEXT_SCHEMA,
  execute: browserWaitForText,
} as const;
