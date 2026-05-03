/**
 * browser_type adapter — wires the TypeUseCase to pi's defineTool.
 *
 * Defines the TypeBox parameter schema, delegates execution to the
 * application-layer use case via the infrastructure BridgeTransport, and
 * formats the result as pi-compatible text content blocks.
 *
 * Imports:
 *   domain/       — validated param types (for type narrowing)
 *   application/  — TypeUseCase, result types
 *   infrastructure/ — BridgeTransport factory
 *   pi SDK        — defineTool, AgentToolResult
 *   typebox       — Type.* schema builders
 *
 * @module adapters/browser-type
 */

import { defineTool, type AgentToolResult } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "typebox";
import { createBridgeTransport } from "../infrastructure/ws-transport.js";
import { executeTypeUseCase } from "../application/type-usecase.js";
import type { TypeResult } from "../application/types.js";
import type { ValidatedTypeParams } from "../domain/schemas.js";
import type { BridgeTransport } from "../domain/ports.js";
import type { ErrorResponse } from "@pi-browser-bridge/protocol";

// ── TypeBox Schema ────────────────────────────────────────────────────────

export const TypeSchema = Type.Object(
  {
    selector: Type.String(),
    text: Type.String(),
    clear: Type.Optional(Type.Boolean()),
    submit: Type.Optional(Type.Boolean()),
    timeout: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { default: { clear: true, submit: false, timeout: 10000 } },
);

export type TypeParams = Static<typeof TypeSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────

function textBlock(text: string) {
  return { type: "text" as const, text };
}

function formatError(err: ErrorResponse, selector?: string, timeout?: number): string {
  const lines = [`Type failed: ${err.message}`];
  if (err.code === "ELEMENT_NOT_FOUND" && selector !== undefined) {
    lines.push(
      `The element "${selector}" was not found within ${timeout ?? 10000}ms.`,
    );
  }
  if (err.code === "ELEMENT_NOT_TYPABLE" && selector !== undefined) {
    lines.push(
      `The element "${selector}" is not a typable element (input, textarea, or contenteditable).`,
    );
  }
  if (err.code === "ELEMENT_NOT_INTERACTABLE" && selector !== undefined) {
    lines.push(
      `The element "${selector}" is not interactable (disabled, hidden, or read-only).`,
    );
  }
  if (err.suggestion) lines.push(err.suggestion);
  return lines.join("\n");
}

// ── Execute ───────────────────────────────────────────────────────────────

async function execute(
  _toolCallId: string,
  params: TypeParams,
  _signal: AbortSignal | undefined,
  _onUpdate: unknown,
  _ctx: unknown,
): Promise<AgentToolResult<undefined>> {
  const transport = createBridgeTransport();
  const result = await executeTypeUseCase(
    transport,
    params as unknown as ValidatedTypeParams,
  );

  if (!result.success) {
    return {
      content: [textBlock(formatError(result.error, params.selector, params.timeout))],
      details: undefined,
    };
  }

  const data = result.data as TypeResult;
  if (!data.typed) {
    const lines = [`Type failed for "${params.selector}".`];
    if (data.suggestions) {
      lines.push("", data.suggestions);
    }
    return { content: [textBlock(lines.join("\n"))], details: undefined };
  }

  return {
    content: [
      textBlock(
        `Typed into "${data.selector}" (current value: "${data.value}").`,
      ),
    ],
    details: undefined,
  };
}

// ── Tool Definition ───────────────────────────────────────────────────────

export const browserTypeTool = defineTool({
  name: "browser_type",
  label: "Browser Type",
  description:
    "Type text into an input element in the current browser tab. Can optionally clear existing value and submit the form.",
  parameters: TypeSchema,
  execute,
});
