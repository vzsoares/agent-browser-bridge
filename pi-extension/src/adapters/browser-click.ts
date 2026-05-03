/**
 * browser_click adapter — wires the ClickUseCase to pi's defineTool.
 *
 * Defines the TypeBox parameter schema, delegates execution to the
 * application-layer use case via the infrastructure BridgeTransport, and
 * formats the result as pi-compatible text content blocks.
 *
 * Imports:
 *   domain/       — validated param types (for type narrowing)
 *   application/  — ClickUseCase, result types
 *   infrastructure/ — BridgeTransport factory
 *   pi SDK        — defineTool, AgentToolResult
 *   typebox       — Type.* schema builders
 *
 * @module adapters/browser-click
 */

import {
	type AgentToolResult,
	defineTool,
} from "@mariozechner/pi-coding-agent";
import type { ErrorResponse } from "@pi-browser-bridge/protocol";
import { type Static, Type } from "typebox";
import { executeClickUseCase } from "../application/click-usecase.js";
import type { ClickResult } from "../application/types.js";
import type { ValidatedClickParams } from "../domain/schemas.js";
import { createBridgeTransport } from "../infrastructure/ws-transport.js";

// ── TypeBox Schema ────────────────────────────────────────────────────────

export const ClickSchema = Type.Object(
	{
		tabId: Type.Optional(Type.Integer()),
		selector: Type.String(),
		text: Type.Optional(Type.String()),
		timeout: Type.Optional(Type.Integer({ minimum: 0 })),
	},
	{ default: { timeout: 10000 } },
);

export type ClickParams = Static<typeof ClickSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────

function textBlock(text: string) {
	return { type: "text" as const, text };
}

/** Shape when the content script returns a click failure. */
interface ClickErrorData {
	clicked: false;
	code: string;
	message: string;
	suggestions?: string[];
}

function formatError(
	err: ErrorResponse,
	_selector?: string,
	timeout?: number,
): string {
	const lines = [`Click failed: ${err.message}`];
	if (err.code === "ELEMENT_NOT_FOUND") {
		lines.push(
			"The element was not found on the page. Check the selector and try again.",
		);
	}
	if (err.code === "ELEMENT_NOT_INTERACTABLE") {
		lines.push(
			"The element exists but cannot be interacted with (hidden or disabled).",
		);
	}
	if (err.code === "TIMEOUT" && timeout !== undefined) {
		lines.push(
			`The click request timed out after ${timeout}ms. The element may have not appeared in time.`,
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

function formatContentError(data: ClickErrorData, selector: string): string {
	const lines = [`Click failed: ${data.message}`];

	if (
		data.code === "ELEMENT_NOT_FOUND" &&
		data.suggestions &&
		data.suggestions.length > 0
	) {
		lines.push(
			"",
			`Elements matching selector "${selector}" on the page:`,
			...data.suggestions.map((s, i) => `  ${i + 1}. "${s}"`),
		);
	} else if (data.code === "ELEMENT_NOT_INTERACTABLE") {
		lines.push(
			"The element exists but is hidden or disabled and cannot be clicked.",
		);
	}

	return lines.join("\n");
}

// ── Execute ───────────────────────────────────────────────────────────────

async function execute(
	_toolCallId: string,
	params: ClickParams,
	_signal: AbortSignal | undefined,
	_onUpdate: unknown,
	_ctx: unknown,
): Promise<AgentToolResult<undefined>> {
	const transport = createBridgeTransport();
	const result = await executeClickUseCase(
		transport,
		params as unknown as ValidatedClickParams,
	);

	if (!result.success) {
		return {
			content: [
				textBlock(formatError(result.error, params.selector, params.timeout)),
			],
			details: undefined,
		};
	}

	// The use case types ClickResult as { clicked: true }, but the content
	// script may return { clicked: false } with error details. Handle both.
	const data = result.data as ClickResult | ClickErrorData;

	if (!data.clicked) {
		return {
			content: [
				textBlock(formatContentError(data as ClickErrorData, params.selector)),
			],
			details: undefined,
		};
	}

	const success = data as ClickResult;
	const lines: string[] = [
		`Clicked element "${success.selector}"`,
		`Element text: "${success.text}"`,
	];

	if (success.navigated) {
		lines.push(
			"Navigation occurred after click.",
			`New title: ${success.newTitle ?? "(unknown)"}`,
			`New URL: ${success.newUrl ?? "(unknown)"}`,
		);
	}

	return { content: [textBlock(lines.join("\n"))], details: undefined };
}

// ── Tool Definition ───────────────────────────────────────────────────────

export const browserClickTool = defineTool({
	name: "browser_click",
	label: "Browser Click",
	description:
		"Click an element in the browser tab identified by a CSS selector. Optionally target a specific tab via tabId; when omitted, defaults to the active tab. Optionally disambiguate by text content.",
	parameters: ClickSchema,
	execute,
});
