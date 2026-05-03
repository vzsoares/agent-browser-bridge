/**
 * browser_type tool — pi-side handler.
 *
 * Sends a type request through the WebSocket bridge to the Chrome extension's
 * content script, which locates the target element and simulates typing with
 * proper event dispatching for framework reactivity (React, Vue, Svelte).
 *
 * @module tools/browser-type
 */

import type { ErrorResponse, Response, TypeParams } from "@pi-browser-bridge/protocol";
import { send } from "../server.js";

// ── Types ──────────────────────────────────────────────────────────────────

/** Validated parameters for the `browser_type` tool. */
export interface BrowserTypeParams {
  /** Target tab ID. When omitted, defaults to the active tab. */
  tabId?: number;
  /** CSS selector of the input element. */
  selector: string;
  /** Text to type into the element. */
  text: string;
  /** Clear existing value before typing. @default true */
  clear?: boolean;
  /** Press Enter after typing (submit surrounding form). @default false */
  submit?: boolean;
  /** Maximum time to wait for the element (ms). @default 10000 */
  timeout?: number;
}

/** Shape of the type result payload returned by the content script. */
interface TypeResult {
  typed: boolean;
  selector: string;
  value: string;
  /** Actionable hint from the content script when element not found. */
  suggestions?: string;
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

// ── Schema (JSON Schema compatible) ────────────────────────────────────────

export const BROWSER_TYPE_SCHEMA = {
  type: "object",
  properties: {
    tabId: {
      type: "integer",
      description: "Target tab ID. When omitted, defaults to the active tab.",
    },
    selector: {
      type: "string",
      description: "CSS selector of the input element to type into.",
    },
    text: {
      type: "string",
      description: "Text to type into the element.",
    },
    clear: {
      type: "boolean",
      default: true,
      description: "Clear any existing value in the element before typing.",
    },
    submit: {
      type: "boolean",
      default: false,
      description: "Press Enter or submit the form after typing.",
    },
    timeout: {
      type: "integer",
      minimum: 0,
      default: 10000,
      description: "Maximum time to wait for the element to appear (ms).",
    },
  },
  required: ["selector", "text"],
} as const;

// ── Validation ─────────────────────────────────────────────────────────────

function validateParams(raw: unknown): raw is BrowserTypeParams {
  if (typeof raw !== "object" || raw === null) return false;
  const p = raw as Record<string, unknown>;

  if (p.tabId !== undefined && (typeof p.tabId !== "number" || !Number.isInteger(p.tabId))) return false;

  if (typeof p.selector !== "string" || p.selector.length === 0) return false;
  if (typeof p.text !== "string") return false;
  if (p.clear !== undefined && typeof p.clear !== "boolean") return false;
  if (p.submit !== undefined && typeof p.submit !== "boolean") return false;
  if (
    p.timeout !== undefined &&
    (typeof p.timeout !== "number" || !Number.isFinite(p.timeout) || p.timeout < 0)
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
 * Type text into an input element in the browser.
 *
 * Delegates the actual typing to the Chrome extension's content script via
 * the WebSocket bridge. The content script handles element lookup, focus,
 * value setting, event dispatching, and optional form submission.
 */
export async function browserType(
  params: BrowserTypeParams,
): Promise<ToolResult> {
  // ── Validate ──────────────────────────────────────────────────────────
  if (!validateParams(params)) {
    return errorResult(
      "Invalid type parameters. Expected: selector (string, required), text (string, required), clear (boolean), submit (boolean), timeout (number).",
    );
  }

  const { selector, text } = params;
  const clear = params.clear ?? true;
  const submit = params.submit ?? false;
  const timeout = params.timeout ?? 10000;

  // ── Send request via WebSocket bridge ─────────────────────────────────
  let response: Response<"type">;
  try {
    response = await send<"type">({
      id: crypto.randomUUID(),
      action: "type",
      params: {
        tabId: params.tabId,
        selector,
        text,
        clear,
        submit,
        timeout,
      } satisfies TypeParams,
    });
  } catch (err) {
    const e = err as ErrorResponse;
    const msg = [`Type request failed: ${e.message ?? String(err)}`];
    if (e.suggestion) msg.push(e.suggestion);
    return errorResult(msg.join("\n"));
  }

  // ── Handle browser-reported error ─────────────────────────────────────
  if (response.error) {
    const { code, message, suggestion } = response.error;
    const lines = [`Type failed: ${message}`];
    if (code === "ELEMENT_NOT_FOUND") {
      lines.push(
        `The element "${selector}" was not found within ${timeout}ms.`,
      );
    }
    if (code === "ELEMENT_NOT_TYPABLE") {
      lines.push(
        `The element "${selector}" is not a typable element (input, textarea, or contenteditable).`,
      );
    }
    if (code === "ELEMENT_NOT_INTERACTABLE") {
      lines.push(
        `The element "${selector}" is not interactable (disabled, hidden, or read-only).`,
      );
    }
    if (suggestion) lines.push(suggestion);
    return errorResult(lines.join("\n"));
  }

  // ── Extract result ────────────────────────────────────────────────────
  const result = response.result as TypeResult | undefined;
  if (!result) {
    return errorResult("Type returned no result.");
  }
  if (!result.typed) {
    const lines = [
      `Type failed for "${selector}".`,
    ];
    if (result.suggestions) {
      lines.push("", result.suggestions);
    }
    return errorResult(lines.join("\n"));
  }

  return {
    content: [
      textBlock(
        `Typed into "${selector}" (current value: "${result.value}").`,
      ),
    ],
  };
}

// ── Tool registration shape ────────────────────────────────────────────────

/**
 * Pi-compatible tool definition.
 *
 * Import and register this in the extension entry-point to expose the
 * `browser_type` tool to the agent.
 */
export const browserTypeTool = {
  name: "browser_type",
  description:
    "Type text into an input element identified by a CSS selector. Optionally target a specific tab via tabId; when omitted, defaults to the active tab. Supports input, textarea, and contenteditable elements. Optionally clears the field first and submits the form after typing.",
  schema: BROWSER_TYPE_SCHEMA,
  execute: browserType,
} as const;
