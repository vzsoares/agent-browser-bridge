/**
 * browser_create_tab tool — pi-side handler.
 *
 * Sends a createTab action request through the WebSocket bridge to the
 * Chrome extension's service worker, which creates a new browser tab
 * and returns its tabId, url, and title.
 *
 * @module tools/browser-create-tab
 */

import type {
  CreateTabParams,
  ErrorResponse,
  Response,
} from "@pi-browser-bridge/protocol";
import { send } from "../server.js";

// ── Types ──────────────────────────────────────────────────────────────────

/** Validated parameters for the `browser_create_tab` tool. */
export interface BrowserCreateTabParams {
  /** URL to open in the new tab. When omitted, opens a blank tab. */
  url?: string;
  /**
   * Whether the new tab should become the active (foreground) tab.
   * @default true
   */
  active?: boolean;
}

/** Shape of the createTab result payload returned by the service worker. */
interface CreateTabResult {
  /** The ID of the newly created tab. */
  tabId: number;
  /** The URL loaded in the new tab. */
  url: string;
  /** The page title of the new tab. */
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

// ── Schema (JSON Schema compatible) ────────────────────────────────────────

export const BROWSER_CREATE_TAB_SCHEMA = {
  type: "object",
  properties: {
    url: {
      type: "string",
      description: "URL to open in the new tab. When omitted, opens a blank tab.",
    },
    active: {
      type: "boolean",
      default: true,
      description: "Whether the new tab should become the active (foreground) tab.",
    },
  },
} as const;

// ── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate raw parameters against the `BrowserCreateTabParams` shape.
 */
function validateParams(raw: unknown): raw is BrowserCreateTabParams {
  if (typeof raw !== "object" || raw === null) return false;
  const p = raw as Record<string, unknown>;

  if (p.url !== undefined && typeof p.url !== "string") return false;

  if (p.active !== undefined && typeof p.active !== "boolean") return false;

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
 * Create a new browser tab.
 *
 * Delegates the actual tab creation to the Chrome extension service worker
 * via the WebSocket bridge. The service worker uses `chrome.tabs.create` to
 * open the new tab, waits for the content script to inject, and returns
 * the tabId, url, and title.
 */
export async function browserCreateTab(
  params?: BrowserCreateTabParams,
): Promise<ToolResult> {
  // ── Validate params shape ─────────────────────────────────────────────
  if (params !== undefined && !validateParams(params)) {
    return errorResult(
      "Invalid create tab parameters. Expected: url (string, optional), " +
        "active (boolean, default true).",
    );
  }

  const url = params?.url;
  const active = params?.active ?? true;

  // ── Send request via WebSocket bridge ─────────────────────────────────
  let response: Response<"createTab">;
  try {
    response = await send<"createTab">({
      id: crypto.randomUUID(),
      action: "createTab",
      params: {
        url,
        active,
      } satisfies CreateTabParams,
    });
  } catch (err) {
    const e = err as ErrorResponse;
    const msg = [`Create tab request failed: ${e.message ?? String(err)}`];
    if (e.suggestion) msg.push(e.suggestion);
    return errorResult(msg.join("\n"));
  }

  // ── Handle browser-reported error ─────────────────────────────────────
  if (response.error) {
    const { code, message, suggestion } = response.error;
    const lines = [`Create tab failed: ${message}`];
    if (code === "BROWSER_NOT_CONNECTED") {
      lines.push(
        "No browser extension is connected. Make sure the Pi Browser Bridge extension is installed and active.",
      );
    }
    if (suggestion) lines.push(suggestion);
    return errorResult(lines.join("\n"));
  }

  // ── Extract result ────────────────────────────────────────────────────
  const result = response.result as CreateTabResult | undefined;
  if (!result) {
    return errorResult("Tab created but returned no result.");
  }

  // ── Build text response ───────────────────────────────────────────────
  return {
    content: [
      textBlock(
        `Created tab ${result.tabId}: ${result.url || "(blank)"}\nPage title: ${result.title || "(no title)"}`,
      ),
    ],
  };
}

// ── Tool registration shape ────────────────────────────────────────────────

/**
 * Pi-compatible tool definition.
 *
 * Import and register this in the extension entry-point to expose the
 * `browser_create_tab` tool to the agent.
 */
export const browserCreateTabTool = {
  name: "browser_create_tab",
  description:
    "Create a new browser tab. Optionally specify a URL to open and whether " +
    "the tab should become active (foreground). Returns the new tab's tabId, " +
    "url, and title. The content script is automatically injected before " +
    "the tool returns, so the tab is immediately ready for automation.",
  schema: BROWSER_CREATE_TAB_SCHEMA,
  execute: browserCreateTab,
} as const;
