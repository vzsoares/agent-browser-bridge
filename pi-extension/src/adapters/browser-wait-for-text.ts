/**
 * browser_wait_for_text adapter — wires the WaitForTextUseCase to pi's defineTool.
 *
 * Defines the TypeBox parameter schema, delegates execution to the
 * application-layer use case via the infrastructure BridgeTransport, and
 * formats the result as pi-compatible text content blocks.
 *
 * Imports:
 *   domain/       — validated param types (for type narrowing)
 *   application/  — WaitForTextUseCase, result types
 *   infrastructure/ — BridgeTransport factory
 *   pi SDK        — defineTool, AgentToolResult
 *   typebox       — Type.* schema builders
 *
 * @module adapters/browser-wait-for-text
 */

import { defineTool, type AgentToolResult } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "typebox";
import { createBridgeTransport } from "../infrastructure/ws-transport.js";
import { executeWaitForTextUseCase } from "../application/wait-for-text-usecase.js";
import type { WaitForTextResult } from "../application/types.js";
import type { ValidatedWaitForTextParams } from "../domain/schemas.js";
import type { BridgeTransport } from "../domain/ports.js";
import type { ErrorResponse } from "@pi-browser-bridge/protocol";

// ── TypeBox Schema ────────────────────────────────────────────────────────

export const WaitForTextSchema = Type.Object(
  {
    text: Type.String(),
    scope: Type.Optional(Type.String()),
    timeout: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { default: { timeout: 10000 } },
);

export type WaitForTextParams = Static<typeof WaitForTextSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────

function textBlock(text: string) {
  return { type: "text" as const, text };
}

function formatError(err: ErrorResponse, text?: string, scope?: string, timeout?: number): string {
  const scopeLabel = scope ? ` within "${scope}"` : "";
  const lines = [`Wait failed: ${err.message}`];
  if (err.code === "TIMEOUT" && text !== undefined) {
    lines.push(
      `Text "${text}" did not appear${scopeLabel} within ${timeout ?? 10000}ms.`,
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
  params: WaitForTextParams,
  _signal: AbortSignal | undefined,
  _onUpdate: unknown,
  _ctx: unknown,
): Promise<AgentToolResult<undefined>> {
  const transport = createBridgeTransport();
  const result = await executeWaitForTextUseCase(
    transport,
    params as unknown as ValidatedWaitForTextParams,
  );

  if (!result.success) {
    return {
      content: [textBlock(formatError(result.error, params.text, params.scope, params.timeout))],
      details: undefined,
    };
  }

  const scopeLabel = params.scope ? ` within "${params.scope}"` : "";

  const data = result.data as WaitForTextResult;
  if (!data.found) {
    return {
      content: [
        textBlock(
          `Text "${params.text}" not found${scopeLabel} within ${data.elapsedMs}ms.`,
        ),
      ],
      details: undefined,
    };
  }

  return {
    content: [
      textBlock(
        `Text "${data.text}" found${scopeLabel} in ${data.elapsedMs}ms.`,
      ),
    ],
    details: undefined,
  };
}

// ── Tool Definition ───────────────────────────────────────────────────────

export const browserWaitForTextTool = defineTool({
  name: "browser_wait_for_text",
  label: "Browser Wait For Text",
  description:
    "Wait for specific text content to appear on the page. Optionally scope to a CSS selector. Returns timing info when found, or TIMEOUT error.",
  parameters: WaitForTextSchema,
  execute,
});
