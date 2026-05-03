/**
 * browser_exec adapter — wires the ExecUseCase to pi's defineTool.
 *
 * Defines the TypeBox parameter schema, delegates execution to the
 * application-layer use case via the infrastructure BridgeTransport, and
 * formats the result as pi-compatible text content blocks.
 *
 * Imports:
 *   domain/       — validated param types (for type narrowing)
 *   application/  — ExecUseCase, result types
 *   infrastructure/ — BridgeTransport factory
 *   pi SDK        — defineTool, AgentToolResult
 *   typebox       — Type.* schema builders
 *
 * @module adapters/browser-exec
 */

import { defineTool, type AgentToolResult } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "typebox";
import { createBridgeTransport } from "../infrastructure/ws-transport.js";
import { executeExecUseCase } from "../application/exec-usecase.js";
import type { ExecResult } from "../application/types.js";
import type { ValidatedExecParams } from "../domain/schemas.js";
import type { BridgeTransport } from "../domain/ports.js";
import type { ErrorResponse } from "@pi-browser-bridge/protocol";

// ── TypeBox Schema ────────────────────────────────────────────────────────

export const ExecSchema = Type.Object({
  code: Type.String(),
});

export type ExecParams = Static<typeof ExecSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────

function textBlock(text: string) {
  return { type: "text" as const, text };
}

function formatError(err: ErrorResponse): string {
  const lines = [`Exec failed: ${err.message}`];
  if (err.code === "BROWSER_NOT_CONNECTED") {
    lines.push(
      "No browser extension is connected. Make sure the Pi Browser Bridge extension is installed and active.",
    );
  }
  if (err.code === "TIMEOUT") {
    lines.push(
      "The JavaScript execution timed out. The code may contain an infinite loop or a long-running async operation.",
    );
  }
  if (err.suggestion) lines.push(err.suggestion);
  return lines.join("\n");
}

// ── Execute ───────────────────────────────────────────────────────────────

async function execute(
  _toolCallId: string,
  params: ExecParams,
  _signal: AbortSignal | undefined,
  _onUpdate: unknown,
  _ctx: unknown,
): Promise<AgentToolResult<undefined>> {
  const transport = createBridgeTransport();
  const result = await executeExecUseCase(
    transport,
    params as unknown as ValidatedExecParams,
  );

  if (!result.success) {
    return {
      content: [textBlock(formatError(result.error))],
      details: undefined,
    };
  }

  // The content script may embed an error structure in the result.
  const raw = result.data as ExecResult & {
    error?: { code: string; message: string; suggestion?: string };
  };

  if (raw?.error) {
    const lines = [`Exec failed: ${raw.error.message}`];
    if (raw.error.suggestion) lines.push(raw.error.suggestion);
    return { content: [textBlock(lines.join("\n"))], details: undefined };
  }

  if (!raw || typeof raw.serialized !== "string") {
    return {
      content: [textBlock("Exec returned no serialised output.")],
      details: undefined,
    };
  }

  return { content: [textBlock(raw.serialized)], details: undefined };
}

// ── Tool Definition ───────────────────────────────────────────────────────

export const browserExecTool = defineTool({
  name: "browser_exec",
  label: "Browser Exec",
  description:
    "Execute arbitrary JavaScript in the page context and return the serialized result. Has a 5-second timeout.",
  parameters: ExecSchema,
  execute,
});
