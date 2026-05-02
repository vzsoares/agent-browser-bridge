/**
 * browser_exec tool — pi-side handler.
 *
 * Sends an `exec` request through the WebSocket bridge to the Chrome
 * extension's content script, which evaluates the JavaScript code in the
 * page context and returns a serialised representation of the result.
 *
 * @module tools/browser-exec
 */

import type {
  ErrorResponse,
  ExecParams,
  ExecResult,
  Response,
} from "@pi-browser-bridge/protocol";
import { send } from "../server.js";

// ── Types ──────────────────────────────────────────────────────────────────

/** Validated parameters for the `browser_exec` tool. */
export interface BrowserExecParams {
  /** JavaScript code to execute in the page context. */
  code: string;
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

export const BROWSER_EXEC_SCHEMA = {
  type: "object",
  properties: {
    code: {
      type: "string",
      description:
        "JavaScript code to execute in the page context. Can access DOM APIs, global variables, and return values. Async code (Promises) is awaited automatically.",
    },
  },
  required: ["code"],
} as const;

// ── Validation ─────────────────────────────────────────────────────────────

function validateParams(raw: unknown): raw is BrowserExecParams {
  if (typeof raw !== "object" || raw === null) return false;
  const p = raw as Record<string, unknown>;

  if (typeof p.code !== "string" || p.code.trim().length === 0) return false;
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
 * Execute arbitrary JavaScript in the current browser tab's page context.
 *
 * Delegates the actual evaluation to the Chrome extension content script via
 * the WebSocket bridge. The content script runs `eval()` in its isolated
 * world, serialises the return value safely, and returns a human-readable
 * string representation (capped at 10 000 characters).
 */
export async function browserExec(
  params: BrowserExecParams,
): Promise<ToolResult> {
  // ── Validate ──────────────────────────────────────────────────────────
  if (!validateParams(params)) {
    return errorResult(
      "Invalid exec parameters. Expected: code (string, non-empty, required).",
    );
  }

  // ── Send request via WebSocket bridge ─────────────────────────────────
  let response: Response<"exec">;
  try {
    response = await send<"exec">({
      id: crypto.randomUUID(),
      action: "exec",
      params: {
        code: params.code,
      } satisfies ExecParams,
    });
  } catch (err) {
    const e = err as ErrorResponse;
    const msg = [`Exec request failed: ${e.message ?? String(err)}`];
    if (e.suggestion) msg.push(e.suggestion);
    return errorResult(msg.join("\n"));
  }

  // ── Handle browser-reported error ─────────────────────────────────────
  if (response.error) {
    const { code, message, suggestion } = response.error;
    const lines = [`Exec failed: ${message}`];
    if (code === "BROWSER_NOT_CONNECTED") {
      lines.push(
        "No browser extension is connected. Make sure the Pi Browser Bridge extension is installed and active.",
      );
    }
    if (code === "TIMEOUT") {
      lines.push(
        "The JavaScript execution timed out. The code may contain an infinite loop or a long-running async operation.",
      );
    }
    if (suggestion) lines.push(suggestion);
    return errorResult(lines.join("\n"));
  }

  // ── Extract result ────────────────────────────────────────────────────
  const result = response.result as (ExecResult & { error?: { code: string; message: string; suggestion?: string } }) | undefined;

  // Handle content-script-level errors (e.g. missing `code` parameter).
  if (result?.error) {
    const lines = [`Exec failed: ${result.error.message}`];
    if (result.error.suggestion) lines.push(result.error.suggestion);
    return errorResult(lines.join("\n"));
  }

  if (!result || typeof result.serialized !== "string") {
    return errorResult("Exec returned no serialised output.");
  }

  // ── Build text block ──────────────────────────────────────────────────
  return { content: [textBlock(result.serialized)] };
}

// ── Tool registration shape ────────────────────────────────────────────────

/**
 * Pi-compatible tool definition.
 *
 * Import and register this in the extension entry-point to expose the
 * `browser_exec` tool to the agent.
 */
export const browserExecTool = {
  name: "browser_exec",
  description:
    "Execute arbitrary JavaScript code in the current browser tab's page context. " +
    "Returns the serialised return value (primitives, JSON with circular-ref handling, or a string representation of functions/symbols/bigints). " +
    "Async code is automatically awaited. Output is capped at 10 000 characters.",
  schema: BROWSER_EXEC_SCHEMA,
  execute: browserExec,
} as const;
