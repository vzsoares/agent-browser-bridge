/**
 * browser_screenshot adapter — wires the ScreenshotUseCase to pi's defineTool.
 *
 * Defines the TypeBox parameter schema, delegates execution to the
 * application-layer use case via the infrastructure BridgeTransport, and
 * formats the result as pi-compatible image + text content blocks.
 *
 * Imports:
 *   domain/       — validated param types (for type narrowing)
 *   application/  — ScreenshotUseCase, result types
 *   infrastructure/ — BridgeTransport factory
 *   pi SDK        — defineTool, AgentToolResult
 *   typebox       — Type.* schema builders
 *
 * @module adapters/browser-screenshot
 */

import { defineTool, type AgentToolResult } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "typebox";
import { createBridgeTransport } from "../infrastructure/ws-transport.js";
import { executeScreenshotUseCase } from "../application/screenshot-usecase.js";
import type { ScreenshotResult } from "../application/types.js";
import type { ValidatedScreenshotParams } from "../domain/schemas.js";
import type { BridgeTransport } from "../domain/ports.js";
import type { ErrorResponse } from "@pi-browser-bridge/protocol";

// ── TypeBox Schema ────────────────────────────────────────────────────────

export const ScreenshotSchema = Type.Object(
  {
    format: Type.Optional(
      Type.Union([Type.Literal("png"), Type.Literal("jpeg")]),
    ),
    quality: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
    fullPage: Type.Optional(Type.Boolean()),
  },
  { default: { format: "png", quality: 80, fullPage: false } },
);

export type ScreenshotParams = Static<typeof ScreenshotSchema>;

// ── Content block types (pi SDK compatible) ──────────────────────────────

/** A pi-compatible text content block. */
type TextBlock = { type: "text"; text: string };
/** A pi-compatible image content block. */
type ImageBlock = { type: "image"; data: string; mimeType: string };
type ContentBlock = TextBlock | ImageBlock;

// ── Helpers ───────────────────────────────────────────────────────────────

function textBlock(text: string): TextBlock {
  return { type: "text", text };
}

function imageBlock(base64Data: string, format: "png" | "jpeg"): ImageBlock {
  const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
  return { type: "image", data: base64Data, mimeType };
}

function formatError(err: ErrorResponse, format?: string): string {
  const lines = [`Screenshot failed: ${err.message}`];
  if (err.code === "RESTRICTED_URL") {
    lines.push(
      "Cannot capture screenshots of chrome://, edge://, or other restricted pages.",
    );
  }
  if (err.code === "TIMEOUT") {
    lines.push(
      "The screenshot timed out. The page may be taking too long to render.",
    );
  }
  if (err.code === "BROWSER_NOT_CONNECTED") {
    lines.push(
      "No browser extension is connected. Make sure the Pi Browser Bridge extension is installed and active.",
    );
  }
  if (err.suggestion) lines.push(err.suggestion);
  return lines.join("\n");
}

// ── Execute ───────────────────────────────────────────────────────────────

async function execute(
  _toolCallId: string,
  params: ScreenshotParams,
  _signal: AbortSignal | undefined,
  _onUpdate: unknown,
  _ctx: unknown,
): Promise<AgentToolResult<undefined>> {
  const transport = createBridgeTransport();
  const result = await executeScreenshotUseCase(
    transport,
    params as unknown as ValidatedScreenshotParams,
  );

  if (!result.success) {
    return {
      content: [textBlock(formatError(result.error, params.format))],
      details: undefined,
    };
  }

  const data = result.data as ScreenshotResult;
  if (!data?.data) {
    return {
      content: [textBlock("Screenshot returned no image data.")],
      details: undefined,
    };
  }

  const format = data.format ?? params.format ?? "png";
  const content: ContentBlock[] = [imageBlock(data.data, format)];

  // Attach warning if the service worker flagged one (e.g. fullPage-in-v1)
  if (data.warning) {
    content.push(textBlock(`⚠️ ${data.warning}`));
  }

  return { content, details: undefined };
}

// ── Tool Definition ───────────────────────────────────────────────────────

export const browserScreenshotTool = defineTool({
  name: "browser_screenshot",
  label: "Browser Screenshot",
  description:
    "Capture a screenshot of the current browser tab. Returns a base64-encoded image in PNG or JPEG format.",
  parameters: ScreenshotSchema,
  execute,
});
