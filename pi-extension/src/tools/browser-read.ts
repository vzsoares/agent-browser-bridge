/**
 * browser_read tool — pi-side handler.
 *
 * Sends a `read` request through the WebSocket bridge to the Chrome extension's
 * content script, receives the extracted visible page text, and formats the
 * result as a pi-compatible text content block.
 *
 * @module tools/browser-read
 */

import type {
  ErrorResponse,
  ReadParams,
  Response,
} from "@pi-browser-bridge/protocol";
import { send } from "../server.js";

// ── Types ──────────────────────────────────────────────────────────────────

/** Validated parameters for the `browser_read` tool. */
export interface BrowserReadParams {
  /** CSS selector scoping the read. Defaults to `body` when omitted. */
  selector?: string;
  /** Truncate returned text to this many characters. @default 50000 */
  maxLength?: number;
}

/** Shape of the read result payload returned by the content script. */
interface ReadResult {
  text: string;
  length: number;
  truncated?: boolean;
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

export const BROWSER_READ_SCHEMA = {
  type: "object",
  properties: {
    selector: {
      type: "string",
      description:
        "CSS selector to scope the read operation. When omitted, the entire page body is read.",
    },
    maxLength: {
      type: "integer",
      minimum: 1,
      default: 50000,
      description:
        "Maximum number of characters to return. Text beyond this limit is truncated with a summary note.",
    },
  },
  required: [],
} as const;

// ── Validation ─────────────────────────────────────────────────────────────

function validateParams(raw: unknown): raw is BrowserReadParams {
  if (typeof raw !== "object" || raw === null) return false;
  const p = raw as Record<string, unknown>;

  if (p.selector !== undefined && typeof p.selector !== "string") {
    return false;
  }
  if (
    p.maxLength !== undefined &&
    (typeof p.maxLength !== "number" ||
      !Number.isInteger(p.maxLength) ||
      p.maxLength < 1)
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
 * Read the visible text content of the current browser tab.
 *
 * Delegates the actual text extraction to the Chrome extension content script
 * via the WebSocket bridge and formats the returned text as a pi-compatible
 * text content block.
 */
export async function browserRead(
  params: BrowserReadParams,
): Promise<ToolResult> {
  // ── Validate ──────────────────────────────────────────────────────────
  if (!validateParams(params)) {
    return errorResult(
      "Invalid read parameters. Expected: selector (string, optional), maxLength (integer, optional, >= 1).",
    );
  }

  const { selector, maxLength } = params;

  // ── Send request via WebSocket bridge ─────────────────────────────────
  let response: Response<"read">;
  try {
    response = await send<"read">({
      id: crypto.randomUUID(),
      action: "read",
      params: {
        selector,
        maxLength,
      } satisfies ReadParams,
    });
  } catch (err) {
    // send() rejects with an ErrorResponse on connection / timeout failures.
    const e = err as ErrorResponse;
    const msg = [`Read request failed: ${e.message ?? String(err)}`];
    if (e.suggestion) msg.push(e.suggestion);
    return errorResult(msg.join("\n"));
  }

  // ── Handle browser-reported error ─────────────────────────────────────
  if (response.error) {
    const { code, message, suggestion } = response.error;
    const lines = [`Read failed: ${message}`];
    if (code === "ELEMENT_NOT_FOUND") {
      lines.push(
        "The selector did not match any element on the page. Check that the element exists and the CSS selector is correct.",
      );
    }
    if (code === "BROWSER_NOT_CONNECTED") {
      lines.push(
        "No browser extension is connected. Make sure the Pi Browser Bridge extension is installed and active.",
      );
    }
    if (code === "TIMEOUT") {
      lines.push(
        "The read operation timed out. The page may be too large or unresponsive.",
      );
    }
    if (suggestion) lines.push(suggestion);
    return errorResult(lines.join("\n"));
  }

  // ── Extract result ────────────────────────────────────────────────────
  const result = response.result as ReadResult | undefined;
  if (!result || typeof result.text !== "string") {
    return errorResult("Read returned no text content.");
  }

  // ── Build text block with optional truncation note ────────────────────
  let text = result.text;

  // Add truncation context when the content was cut off
  if (result.truncated) {
    const note = `\n\n[truncated — ${result.length.toLocaleString()} chars total; showing first ${(params.maxLength ?? 50000).toLocaleString()}]`;
    text += note;
  }

  return { content: [textBlock(text)] };
}

// ── Tool registration shape ────────────────────────────────────────────────

/**
 * Pi-compatible tool definition.
 *
 * Import and register this in the extension entry-point to expose the
 * `browser_read` tool to the agent.
 */
export const browserReadTool = {
  name: "browser_read",
  description:
    "Read visible text content from the current browser tab. Extracts structured text — headings, paragraphs, list items, links, buttons, inputs, and images (alt text) — while excluding hidden elements, scripts, and styles. Use an optional CSS selector to scope the read to a specific part of the page.",
  schema: BROWSER_READ_SCHEMA,
  execute: browserRead,
} as const;
