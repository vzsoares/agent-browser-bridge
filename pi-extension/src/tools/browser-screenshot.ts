/**
 * browser_screenshot tool — pi-side handler.
 *
 * Sends a screenshot request through the WebSocket bridge to the Chrome
 * extension's service worker, receives the base64-encoded image, and formats
 * the result as a pi-compatible image content block.
 *
 * @module tools/browser-screenshot
 */

import type { ErrorResponse, Response, ScreenshotParams } from "@pi-browser-bridge/protocol";
import { send } from "../server.js";

// ── Types ──────────────────────────────────────────────────────────────────

/** Validated parameters for the `browser_screenshot` tool. */
export interface BrowserScreenshotParams {
  /** Target tab ID. Defaults to the active tab when omitted. */
  tabId?: number;
  /** Image format. @default "png" */
  format?: "png" | "jpeg";
  /** JPEG quality (0–100). Ignored when format is `"png"`. @default 80 */
  quality?: number;
  /**
   * Capture the full scrollable page.
   * **v1 limitation**: only the visible viewport is captured.
   * @default false
   */
  fullPage?: boolean;
}

/** Shape of the screenshot result payload returned by the service worker. */
interface ScreenshotResult {
  data: string; // raw base64 (no data-URL prefix)
  format: "png" | "jpeg";
  /** Optional warning message (e.g. fullPage-in-v1 caveat). */
  warning?: string;
}

/** A pi-compatible image content block. */
interface ImageContentBlock {
  type: "image";
  source: {
    type: "base64";
    mediaType: "image/png" | "image/jpeg";
    data: string;
  };
}

/** A pi-compatible text content block. */
interface TextContentBlock {
  type: "text";
  text: string;
}

/** Union of content blocks returned by the tool. */
type ContentBlock = ImageContentBlock | TextContentBlock;

/** Standardised return shape for pi tools. */
interface ToolResult {
  content: ContentBlock[];
  /** When true the result represents an error the agent should surface. */
  isError?: boolean;
}

// ── Schema (JSON Schema compatible) ────────────────────────────────────────

export const BROWSER_SCREENSHOT_SCHEMA = {
  type: "object",
  properties: {
    tabId: {
      type: "integer",
      description: "Target tab ID. Defaults to the active tab when omitted.",
    },
    format: {
      type: "string",
      enum: ["png", "jpeg"],
      default: "png",
      description: "Image format for the screenshot.",
    },
    quality: {
      type: "integer",
      minimum: 0,
      maximum: 100,
      default: 80,
      description: "JPEG quality (0–100). Only meaningful when format is 'jpeg'.",
    },
    fullPage: {
      type: "boolean",
      default: false,
      description:
        "Capture the full scrollable page. ⚠️ v1 limitation: only the visible viewport is captured.",
    },
  },
  required: [],
} as const;

// ── Validation ─────────────────────────────────────────────────────────────

function validateParams(raw: unknown): raw is BrowserScreenshotParams {
  if (typeof raw !== "object" || raw === null) return false;
  const p = raw as Record<string, unknown>;

  if (p.tabId !== undefined && (typeof p.tabId !== "number" || !Number.isInteger(p.tabId))) return false;

  if (p.format !== undefined && p.format !== "png" && p.format !== "jpeg") {
    return false;
  }
  if (
    p.quality !== undefined &&
    (typeof p.quality !== "number" ||
      !Number.isInteger(p.quality) ||
      p.quality < 0 ||
      p.quality > 100)
  ) {
    return false;
  }
  if (p.fullPage !== undefined && typeof p.fullPage !== "boolean") {
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

function mediaTypeFromFormat(f: "png" | "jpeg"): "image/png" | "image/jpeg" {
  return f === "jpeg" ? "image/jpeg" : "image/png";
}

// ── Handler ────────────────────────────────────────────────────────────────

/**
 * Capture a screenshot of the current browser tab.
 *
 * Delegates the actual capture to the Chrome extension service worker via
 * the WebSocket bridge and formats the returned base64 data as a pi-compatible
 * image content block.
 */
export async function browserScreenshot(
  params: BrowserScreenshotParams,
): Promise<ToolResult> {
  // ── Validate ──────────────────────────────────────────────────────────
  if (!validateParams(params)) {
    return errorResult(
      "Invalid screenshot parameters. Expected: format ('png' | 'jpeg'), quality (0–100, integer), fullPage (boolean).",
    );
  }

  const format = params.format ?? "png";
  const quality = format === "jpeg" ? (params.quality ?? 80) : undefined;
  const fullPage = params.fullPage ?? false;

  // ── Send request via WebSocket bridge ─────────────────────────────────
  let response: Response<"screenshot">;
  try {
    response = await send<"screenshot">({
      id: crypto.randomUUID(),
      action: "screenshot",
      params: {
        tabId: params.tabId,
        format,
        quality,
        fullPage,
      } satisfies ScreenshotParams,
    });
  } catch (err) {
    // send() rejects with an ErrorResponse on connection / timeout failures.
    const e = err as ErrorResponse;
    const msg = [`Screenshot request failed: ${e.message ?? String(err)}`];
    if (e.suggestion) msg.push(e.suggestion);
    return errorResult(msg.join("\n"));
  }

  // ── Handle browser-reported error ─────────────────────────────────────
  if (response.error) {
    const { code, message, suggestion } = response.error;
    const lines = [`Screenshot failed: ${message}`];
    if (code === "RESTRICTED_URL") {
      lines.push(
        "Cannot capture screenshots of chrome://, edge://, or other restricted pages.",
      );
    }
    if (code === "TIMEOUT") {
      lines.push(
        "The screenshot timed out. The page may be taking too long to render.",
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
  const result = response.result as ScreenshotResult | undefined;
  if (!result?.data) {
    return errorResult("Screenshot returned no image data.");
  }

  // ── Build image content block ─────────────────────────────────────────
  const imageBlock: ImageContentBlock = {
    type: "image",
    source: {
      type: "base64",
      mediaType: mediaTypeFromFormat(format),
      data: result.data,
    },
  };

  const content: ContentBlock[] = [imageBlock];

  // Attach warning if the service worker flagged one (e.g. fullPage-in-v1)
  if (result.warning) {
    content.push(textBlock(`⚠️ ${result.warning}`));
  }

  return { content };
}

// ── Tool registration shape ────────────────────────────────────────────────

/**
 * Pi-compatible tool definition.
 *
 * Import and register this in the extension entry-point to expose the
 * `browser_screenshot` tool to the agent.
 */
export const browserScreenshotTool = {
  name: "browser_screenshot",
  description:
    "Capture a screenshot of the current browser tab. Returns a base64-encoded image in PNG or JPEG format. Note: tabId is not supported for screenshots in v1; always captures the active tab. Full-page capture is viewport-only in v1.",
  schema: BROWSER_SCREENSHOT_SCHEMA,
  execute: browserScreenshot,
} as const;
