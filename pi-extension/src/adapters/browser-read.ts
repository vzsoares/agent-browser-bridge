/**
 * browser_read adapter — wires the ReadUseCase to pi's defineTool.
 *
 * Defines the TypeBox parameter schema, delegates execution to the
 * application-layer use case via the infrastructure BridgeTransport, and
 * formats the result as pi-compatible text content blocks.
 *
 * Imports:
 *   domain/       — validated param types (for type narrowing)
 *   application/  — ReadUseCase, result types
 *   infrastructure/ — BridgeTransport factory
 *   pi SDK        — defineTool, AgentToolResult
 *   typebox       — Type.* schema builders
 *
 * @module adapters/browser-read
 */

import { defineTool, type AgentToolResult } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "typebox";
import { createBridgeTransport } from "../infrastructure/ws-transport.js";
import { executeReadUseCase } from "../application/read-usecase.js";
import type { ReadResult } from "../application/types.js";
import type { ValidatedReadParams } from "../domain/schemas.js";
import type { BridgeTransport } from "../domain/ports.js";
import type { ErrorResponse } from "@pi-browser-bridge/protocol";

// ── TypeBox Schema ────────────────────────────────────────────────────────

export const ReadSchema = Type.Object(
  {
    selector: Type.Optional(Type.String()),
    maxLength: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { default: { maxLength: 50000 } },
);

export type ReadParams = Static<typeof ReadSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────

function textBlock(text: string) {
  return { type: "text" as const, text };
}

function formatError(err: ErrorResponse): string {
  const lines = [`Read failed: ${err.message}`];
  if (err.code === "ELEMENT_NOT_FOUND") {
    lines.push(
      "The selector did not match any element on the page. Check that the element exists and the CSS selector is correct.",
    );
  }
  if (err.code === "BROWSER_NOT_CONNECTED") {
    lines.push(
      "No browser extension is connected. Make sure the Pi Browser Bridge extension is installed and active.",
    );
  }
  if (err.code === "TIMEOUT") {
    lines.push(
      "The read operation timed out. The page may be too large or unresponsive.",
    );
  }
  if (err.suggestion) lines.push(err.suggestion);
  return lines.join("\n");
}

// ── Execute ───────────────────────────────────────────────────────────────

async function execute(
  _toolCallId: string,
  params: ReadParams,
  _signal: AbortSignal | undefined,
  _onUpdate: unknown,
  _ctx: unknown,
): Promise<AgentToolResult<undefined>> {
  const transport = createBridgeTransport();
  const result = await executeReadUseCase(
    transport,
    params as unknown as ValidatedReadParams,
  );

  if (!result.success) {
    return {
      content: [textBlock(formatError(result.error))],
      details: undefined,
    };
  }

  const data = result.data as ReadResult;
  if (!data || typeof data.text !== "string") {
    return {
      content: [textBlock("Read returned no text content.")],
      details: undefined,
    };
  }

  let text = data.text;

  // Add truncation context when the content was cut off
  if (data.truncated) {
    const maxLen = (params.maxLength ?? 50000).toLocaleString();
    const total = data.length.toLocaleString();
    text += `\n\n[truncated — ${total} chars total; showing first ${maxLen}]`;
  }

  return { content: [textBlock(text)], details: undefined };
}

// ── Tool Definition ───────────────────────────────────────────────────────

export const browserReadTool = defineTool({
  name: "browser_read",
  label: "Browser Read",
  description:
    "Read the text content of the current browser tab. Can scope to a CSS selector or read the entire page body.",
  parameters: ReadSchema,
  execute,
});
