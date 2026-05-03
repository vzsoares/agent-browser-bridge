// @pi-browser-bridge/pi-extension — pi coding agent extension
// Delegates to the adapters layer for tool definitions and lifecycle management.

// ── Adapters layer (canonical source) ──────────────────────────────────

export {
	browserClickTool,
	browserCreateTabTool,
	browserExecTool,
	// Tool definitions (pi defineTool)
	browserNavigateTool,
	browserReadTool,
	browserScreenshotTool,
	browserTypeTool,
	browserWaitForElementTool,
	browserWaitForTextTool,
	type ClickParams,
	ClickSchema,
	type CreateTabParams,
	CreateTabSchema,
	type ExecParams,
	ExecSchema,
	// Param types
	type NavigateParams,
	// TypeBox schemas
	NavigateSchema,
	type ReadParams,
	ReadSchema,
	// Lifecycle
	registerAllTools,
	type ScreenshotParams,
	ScreenshotSchema,
	type TypeParams,
	TypeSchema,
	// Tool collection
	tools,
	type WaitForElementParams,
	WaitForElementSchema,
	type WaitForTextParams,
	WaitForTextSchema,
} from "./adapters/index.js";

// ── Legacy tool handlers (backward-compatible re-exports) ──────────────
//
// These are the older standalone handlers used by tools/ and external
// consumers.  New code should use the adapters layer above.

export {
	BROWSER_CLICK_SCHEMA,
	browserClick,
	browserClickTool as legacyClickTool,
} from "./tools/browser-click.js";
export {
	BROWSER_EXEC_SCHEMA,
	browserExec,
	browserExecTool as legacyExecTool,
} from "./tools/browser-exec.js";
export {
	BROWSER_NAVIGATE_SCHEMA,
	browserNavigate,
	browserNavigateTool as legacyNavigateTool,
} from "./tools/browser-navigate.js";
export {
	BROWSER_READ_SCHEMA,
	browserRead,
	browserReadTool as legacyReadTool,
} from "./tools/browser-read.js";
export {
	BROWSER_SCREENSHOT_SCHEMA,
	browserScreenshot,
	browserScreenshotTool as legacyScreenshotTool,
} from "./tools/browser-screenshot.js";
export {
	BROWSER_TYPE_SCHEMA,
	browserType,
	browserTypeTool as legacyTypeTool,
} from "./tools/browser-type.js";
export {
	BROWSER_WAIT_FOR_ELEMENT_SCHEMA,
	browserWaitForElement,
	browserWaitForElementTool as legacyWaitForElementTool,
} from "./tools/browser-wait-for-element.js";
export {
	BROWSER_WAIT_FOR_TEXT_SCHEMA,
	browserWaitForText,
	browserWaitForTextTool as legacyWaitForTextTool,
} from "./tools/browser-wait-for-text.js";
export {
	BROWSER_CREATE_TAB_SCHEMA,
	browserCreateTab,
	browserCreateTabTool as legacyCreateTabTool,
} from "./tools/browser-create-tab.js";

// ── Server facades (backward-compatible) ───────────────────────────────

export { onResponse, send, start, stop } from "./server.js";

// ── Default export for pi auto-loading ─────────────────────────────────
//
// Delegates to the adapters layer which registers all 9 browser tools
// and manages the WebSocket server lifecycle.

export { default } from "./adapters/index.js";
