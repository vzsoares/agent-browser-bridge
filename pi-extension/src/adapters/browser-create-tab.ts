/**
 * browser_create_tab adapter — wires the CreateTabUseCase to pi's defineTool.
 *
 * Defines the TypeBox parameter schema, delegates execution to the
 * application-layer use case via the infrastructure BridgeTransport, and
 * formats the result as pi-compatible text content blocks.
 *
 * Imports:
 *   domain/       — validated param types (for type narrowing)
 *   application/  — CreateTabUseCase, result types
 *   infrastructure/ — BridgeTransport factory
 *   pi SDK        — defineTool, AgentToolResult
 *   typebox       — Type.* schema builders
 *
 * @module adapters/browser-create-tab
 */

import {
	type AgentToolResult,
	defineTool,
} from "@mariozechner/pi-coding-agent";
import type { ErrorResponse } from "@pi-browser-bridge/protocol";
import { type Static, Type } from "typebox";
import { executeCreateTabUseCase } from "../application/create-tab-usecase.js";
import type { CreateTabResult } from "../application/types.js";
import type { ValidatedCreateTabParams } from "../domain/schemas.js";
import { createBridgeTransport } from "../infrastructure/ws-transport.js";

// ── TypeBox Schema ────────────────────────────────────────────────────────

export const CreateTabSchema = Type.Object({
	url: Type.Optional(Type.String()),
	active: Type.Optional(Type.Boolean()),
}, { default: { active: true } });

export type CreateTabParams = Static<typeof CreateTabSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────

function textBlock(text: string) {
	return { type: "text" as const, text };
}

function formatError(err: ErrorResponse): string {
	const lines = [`Create tab failed: ${err.message}`];
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
	params: CreateTabParams,
	_signal: AbortSignal | undefined,
	_onUpdate: unknown,
	_ctx: unknown,
): Promise<AgentToolResult<undefined>> {
	const transport = createBridgeTransport();
	const result = await executeCreateTabUseCase(
		transport,
		params as unknown as ValidatedCreateTabParams,
	);

	if (!result.success) {
		return {
			content: [textBlock(formatError(result.error))],
			details: undefined,
		};
	}

	const data = result.data as CreateTabResult;
	return {
		content: [
			textBlock(
				`Created tab ${data.tabId}: ${data.url || "(blank)"}\nPage title: ${data.title || "(no title)"}`,
			),
		],
		details: undefined,
	};
}

// ── Tool Definition ───────────────────────────────────────────────────────

export const browserCreateTabTool = defineTool({
	name: "browser_create_tab",
	label: "Browser Create Tab",
	description:
		"Create a new browser tab. Optionally specify a URL to open and whether the tab should become active (foreground). Returns the new tab's tabId, url, and title. The content script is automatically injected before the tool returns, so the tab is immediately ready for automation.",
	parameters: CreateTabSchema,
	execute,
});
