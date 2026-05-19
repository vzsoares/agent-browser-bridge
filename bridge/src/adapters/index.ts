/**
 * Adapters layer barrel — exports MCP tool definitions and a single
 * `registerAllTools` helper to wire them onto an {@link McpServer}.
 *
 * Each per-tool adapter imports its Zod schema from `domain/schemas.ts`
 * and delegates execution to the matching application-layer use case.
 *
 * @module adapters
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { browserClickTool } from "./browser-click.js";
import { browserCloseTabTool } from "./browser-close-tab.js";
import { browserCreateTabTool } from "./browser-create-tab.js";
import { browserExecTool } from "./browser-exec.js";
import { browserListTabsTool } from "./browser-list-tabs.js";
import { browserNavigateTool } from "./browser-navigate.js";
import { browserReadTool } from "./browser-read.js";
import { browserScreenshotTool } from "./browser-screenshot.js";
import { browserTypeTool } from "./browser-type.js";
import { browserWaitForElementTool } from "./browser-wait-for-element.js";
import { browserWaitForTextTool } from "./browser-wait-for-text.js";

// ── Per-tool exports ──────────────────────────────────────────────────────

export {
	browserClickTool,
	ClickSchema,
	executeClick,
} from "./browser-click.js";
export {
	browserCloseTabTool,
	CloseTabSchema,
	executeCloseTab,
} from "./browser-close-tab.js";
export {
	browserCreateTabTool,
	CreateTabSchema,
	executeCreateTab,
} from "./browser-create-tab.js";
export { browserExecTool, ExecSchema, executeExec } from "./browser-exec.js";
export {
	browserListTabsTool,
	executeListTabs,
	ListTabsSchema,
} from "./browser-list-tabs.js";
export {
	browserNavigateTool,
	executeNavigate,
	NavigateSchema,
} from "./browser-navigate.js";
export { browserReadTool, executeRead, ReadSchema } from "./browser-read.js";
export {
	browserScreenshotTool,
	executeScreenshot,
	ScreenshotSchema,
} from "./browser-screenshot.js";
export { browserTypeTool, executeType, TypeSchema } from "./browser-type.js";
export {
	browserWaitForElementTool,
	executeWaitForElement,
	WaitForElementSchema,
} from "./browser-wait-for-element.js";
export {
	browserWaitForTextTool,
	executeWaitForText,
	WaitForTextSchema,
} from "./browser-wait-for-text.js";

// ── Tool collection ───────────────────────────────────────────────────────

/** All MCP tool definitions for the 11 browser-automation tools. */
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

// ── Registration ──────────────────────────────────────────────────────────

/**
 * Register every browser tool on the given {@link McpServer}.
 *
 * The MCP SDK accepts a Zod rawShape for `inputSchema` and infers the
 * handler's argument type from it; our domain schemas are Zod objects, so
 * we pass `.shape` directly.
 */
export function registerAllTools(server: McpServer): void {
	for (const tool of tools) {
		server.registerTool(
			tool.name,
			{
				description: tool.description,
				inputSchema: tool.inputSchema,
			},
			// The SDK's inferred arg type from `inputSchema` matches each tool's
			// Validated*Params (z.infer of the same schema). We cast generically
			// here so the per-tool execute signatures don't have to widen.
			tool.execute as never,
		);
	}
}
