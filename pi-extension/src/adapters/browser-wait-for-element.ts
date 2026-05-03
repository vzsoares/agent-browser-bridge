/**
 * browser_wait_for_element adapter — wires the WaitForElementUseCase to pi's defineTool.
 *
 * Defines the TypeBox parameter schema, delegates execution to the
 * application-layer use case via the infrastructure BridgeTransport, and
 * formats the result as pi-compatible text content blocks.
 *
 * Imports:
 *   domain/       — validated param types (for type narrowing)
 *   application/  — WaitForElementUseCase, result types
 *   infrastructure/ — BridgeTransport factory
 *   pi SDK        — defineTool, AgentToolResult
 *   typebox       — Type.* schema builders
 *
 * @module adapters/browser-wait-for-element
 */

import {
	type AgentToolResult,
	defineTool,
} from "@mariozechner/pi-coding-agent";
import type { ErrorResponse } from "@pi-browser-bridge/protocol";
import { type Static, Type } from "typebox";
import type { WaitForElementResult } from "../application/types.js";
import { executeWaitForElementUseCase } from "../application/wait-for-element-usecase.js";
import type { ValidatedWaitForElementParams } from "../domain/schemas.js";
import { createBridgeTransport } from "../infrastructure/ws-transport.js";

// ── TypeBox Schema ────────────────────────────────────────────────────────

export const WaitForElementSchema = Type.Object(
	{
		tabId: Type.Optional(Type.Integer()),
		selector: Type.String(),
		timeout: Type.Optional(Type.Integer({ minimum: 0 })),
	},
	{ default: { timeout: 10000 } },
);

export type WaitForElementParams = Static<typeof WaitForElementSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────

function textBlock(text: string) {
	return { type: "text" as const, text };
}

function formatError(
	err: ErrorResponse,
	selector?: string,
	timeout?: number,
): string {
	const lines = [`Wait failed: ${err.message}`];
	if (err.code === "TIMEOUT" && selector !== undefined) {
		lines.push(
			`Element "${selector}" did not appear within ${timeout ?? 10000}ms.`,
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
	params: WaitForElementParams,
	_signal: AbortSignal | undefined,
	_onUpdate: unknown,
	_ctx: unknown,
): Promise<AgentToolResult<undefined>> {
	const transport = createBridgeTransport();
	const result = await executeWaitForElementUseCase(
		transport,
		params as unknown as ValidatedWaitForElementParams,
	);

	if (!result.success) {
		return {
			content: [
				textBlock(formatError(result.error, params.selector, params.timeout)),
			],
			details: undefined,
		};
	}

	const data = result.data as WaitForElementResult;
	if (!data.found) {
		return {
			content: [
				textBlock(
					`Element "${params.selector}" not found within ${data.elapsedMs}ms.`,
				),
			],
			details: undefined,
		};
	}

	return {
		content: [
			textBlock(
				`Element "${data.selector}" (<${data.tagName}>) found in ${data.elapsedMs}ms.`,
			),
		],
		details: undefined,
	};
}

// ── Tool Definition ───────────────────────────────────────────────────────

export const browserWaitForElementTool = defineTool({
	name: "browser_wait_for_element",
	label: "Browser Wait For Element",
	description:
		"Wait for an element matching a CSS selector to appear in the DOM. Optionally target a specific tab via tabId; when omitted, defaults to the active tab. Returns timing info when found, or TIMEOUT error.",
	parameters: WaitForElementSchema,
	execute,
});
