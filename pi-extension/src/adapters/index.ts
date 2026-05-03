/**
 * Adapters layer barrel export.
 *
 * This module exports the pi ExtensionAPI integration and tool definitions
 * that wire application use cases to pi's `defineTool`. Each adapter file
 * corresponds to one browser-automation tool.
 *
 * The adapters layer imports from:
 *   domain/       — validated parameter types
 *   application/  — use cases and result types
 *   infrastructure/ — BridgeTransport factory, server lifecycle
 *   pi SDK        — defineTool, AgentToolResult, ExtensionAPI
 *   typebox       — Type.* schema builders
 *
 * @module adapters
 */

export type { ClickParams } from "./browser-click.js";
// ── Click ─────────────────────────────────────────────────────────────────
export { browserClickTool, ClickSchema } from "./browser-click.js";
export type { ExecParams } from "./browser-exec.js";
// ── Exec ──────────────────────────────────────────────────────────────────
export { browserExecTool, ExecSchema } from "./browser-exec.js";
export type { NavigateParams } from "./browser-navigate.js";
// ── Navigate ──────────────────────────────────────────────────────────────
export { browserNavigateTool, NavigateSchema } from "./browser-navigate.js";
export type { ReadParams } from "./browser-read.js";
// ── Read ──────────────────────────────────────────────────────────────────
export { browserReadTool, ReadSchema } from "./browser-read.js";
export type { ScreenshotParams } from "./browser-screenshot.js";
// ── Screenshot ────────────────────────────────────────────────────────────
export {
	browserScreenshotTool,
	ScreenshotSchema,
} from "./browser-screenshot.js";
// ── Create Tab ────────────────────────────────────────────────────────────
export { browserCreateTabTool, CreateTabSchema } from "./browser-create-tab.js";
export type { CreateTabParams } from "./browser-create-tab.js";
// ── List Tabs ─────────────────────────────────────────────────────────────
export { browserListTabsTool, ListTabsSchema } from "./browser-list-tabs.js";
export type { ListTabsParams } from "./browser-list-tabs.js";
// ── Close Tab ─────────────────────────────────────────────────────────────
export { browserCloseTabTool, CloseTabSchema } from "./browser-close-tab.js";
export type { CloseTabParams } from "./browser-close-tab.js";
export type { TypeParams } from "./browser-type.js";
// ── Type ─────────────────────────────────────────────────────────────────
export { browserTypeTool, TypeSchema } from "./browser-type.js";
export type { WaitForElementParams } from "./browser-wait-for-element.js";
// ── Wait For Element ──────────────────────────────────────────────────────
export {
	browserWaitForElementTool,
	WaitForElementSchema,
} from "./browser-wait-for-element.js";
export type { WaitForTextParams } from "./browser-wait-for-text.js";
// ── Wait For Text ─────────────────────────────────────────────────────────
export {
	browserWaitForTextTool,
	WaitForTextSchema,
} from "./browser-wait-for-text.js";

// ── Tool collection ───────────────────────────────────────────────────────

import { browserClickTool } from "./browser-click.js";
import { browserExecTool } from "./browser-exec.js";
import { browserNavigateTool } from "./browser-navigate.js";
import { browserReadTool } from "./browser-read.js";
import { browserScreenshotTool } from "./browser-screenshot.js";
import { browserCreateTabTool } from "./browser-create-tab.js";
import { browserListTabsTool } from "./browser-list-tabs.js";
import { browserCloseTabTool } from "./browser-close-tab.js";
import { browserTypeTool } from "./browser-type.js";
import { browserWaitForElementTool } from "./browser-wait-for-element.js";
import { browserWaitForTextTool } from "./browser-wait-for-text.js";

/** All pi ToolDefinition objects for the 11 core browser-automation tools. */
export const tools = [
	browserNavigateTool,
	browserClickTool,
	browserTypeTool,
	browserReadTool,
	browserScreenshotTool,
	browserExecTool,
	browserWaitForElementTool,
	browserWaitForTextTool,
	browserCreateTabTool,
	browserListTabsTool,
	browserCloseTabTool,
] as const;

// ── Lifecycle registration helper ─────────────────────────────────────────

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { start, stop } from "../infrastructure/ws-server.js";

/**
 * Register all browser-automation tools with pi and wire up the server
 * lifecycle.
 *
 * Call this from the extension's default export function, or use
 * {@link registerAllTools} for individual control.
 *
 * @param pi — The pi ExtensionAPI instance.
 */
export function registerAllTools(pi: ExtensionAPI): void {
	pi.registerTool(browserNavigateTool);
	pi.registerTool(browserClickTool);
	pi.registerTool(browserTypeTool);
	pi.registerTool(browserReadTool);
	pi.registerTool(browserScreenshotTool);
	pi.registerTool(browserExecTool);
	pi.registerTool(browserWaitForElementTool);
	pi.registerTool(browserWaitForTextTool);
	pi.registerTool(browserCreateTabTool);
	pi.registerTool(browserListTabsTool);
	pi.registerTool(browserCloseTabTool);

	pi.on("session_start", async () => {
		await start();
	});

	pi.on("session_shutdown", async () => {
		await stop();
	});
}

/**
 * Default export for auto-loading by pi.
 *
 * Registers all 11 core browser tools and manages the WebSocket server
 * lifecycle (start on session_start, stop on session_shutdown).
 */
export default function (pi: ExtensionAPI): void {
	registerAllTools(pi);
}
