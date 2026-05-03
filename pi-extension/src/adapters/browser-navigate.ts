/**
 * browser_navigate adapter — wires the NavigateUseCase to pi's defineTool.
 *
 * Defines the TypeBox parameter schema, delegates execution to the
 * application-layer use case via the infrastructure BridgeTransport, and
 * formats the result as pi-compatible text content blocks.
 *
 * Imports:
 *   domain/       — validated param types (for type narrowing)
 *   application/  — NavigateUseCase, result types
 *   infrastructure/ — BridgeTransport factory
 *   pi SDK        — defineTool, AgentToolResult
 *   typebox       — Type.* schema builders
 *
 * @module adapters/browser-navigate
 */

import { defineTool, type AgentToolResult } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "typebox";
import { createBridgeTransport } from "../infrastructure/ws-transport.js";
import { executeNavigateUseCase } from "../application/navigate-usecase.js";
import type { NavigateResult } from "../application/types.js";
import type { ValidatedNavigateParams } from "../domain/schemas.js";
import type { BridgeTransport } from "../domain/ports.js";
import type { ErrorResponse } from "@pi-browser-bridge/protocol";

// ── TypeBox Schema ────────────────────────────────────────────────────────

export const NavigateSchema = Type.Object(
  {
    url: Type.String(),
    waitUntil: Type.Optional(
      Type.Union([
        Type.Literal("load"),
        Type.Literal("domcontentloaded"),
        Type.Literal("networkidle"),
      ]),
    ),
    timeout: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { default: { waitUntil: "load", timeout: 30000 } },
);

export type NavigateParams = Static<typeof NavigateSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────

function textBlock(text: string) {
  return { type: "text" as const, text };
}

function formatError(err: ErrorResponse, context?: { timeout?: number }): string {
  const lines = [`Navigate failed: ${err.message}`];
  if (err.code === "RESTRICTED_URL") {
    lines.push(
      "Cannot navigate to chrome://, edge://, or other restricted pages.",
    );
  }
  if (err.code === "TIMEOUT" && context?.timeout !== undefined) {
    lines.push(
      `The page took longer than ${context.timeout}ms to load. Try increasing the timeout or check the URL.`,
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
  params: NavigateParams,
  _signal: AbortSignal | undefined,
  _onUpdate: unknown,
  _ctx: unknown,
): Promise<AgentToolResult<undefined>> {
  const transport = createBridgeTransport();
  // TypeBox applies defaults so params.url, .waitUntil, .timeout are all
  // present at runtime. Cast for the use case's Zod-inferred type.
  const result = await executeNavigateUseCase(
    transport,
    params as unknown as ValidatedNavigateParams,
  );

  if (!result.success) {
    return {
      content: [textBlock(formatError(result.error, { timeout: params.timeout }))],
      details: undefined,
    };
  }

  const data = result.data as NavigateResult;
  return {
    content: [
      textBlock(
        `Navigated to: ${data.url}\nPage title: ${data.title || "(no title)"}`,
      ),
    ],
    details: undefined,
  };
}

// ── Tool Definition ───────────────────────────────────────────────────────

export const browserNavigateTool = defineTool({
  name: "browser_navigate",
  label: "Browser Navigate",
  description:
    "Navigate the current browser tab to a URL. Supports waiting for page load, DOMContentLoaded, or network idle.",
  parameters: NavigateSchema,
  execute,
});
