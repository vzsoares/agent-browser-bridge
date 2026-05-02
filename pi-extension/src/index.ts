// @pi-browser-bridge/pi-extension — pi coding agent extension
// WebSocket server and tool handlers with TypeBox-typed pi integration.

import { Type } from "typebox";
import { defineTool, type AgentToolResult, type ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ── Re-exports ───────────────────────────────────────────────────────

export { start, stop, send, onResponse } from "./server.js";

export { browserScreenshot, browserScreenshotTool, BROWSER_SCREENSHOT_SCHEMA } from "./tools/browser-screenshot.js";
export { browserRead, browserReadTool, BROWSER_READ_SCHEMA } from "./tools/browser-read.js";
export { browserClick, browserClickTool, BROWSER_CLICK_SCHEMA } from "./tools/browser-click.js";
export { browserType, browserTypeTool, BROWSER_TYPE_SCHEMA } from "./tools/browser-type.js";
export { browserNavigate, browserNavigateTool, BROWSER_NAVIGATE_SCHEMA } from "./tools/browser-navigate.js";
export { browserExec, browserExecTool, BROWSER_EXEC_SCHEMA } from "./tools/browser-exec.js";
export { browserWaitForElement, browserWaitForElementTool, BROWSER_WAIT_FOR_ELEMENT_SCHEMA } from "./tools/browser-wait-for-element.js";
export { browserWaitForText, browserWaitForTextTool, BROWSER_WAIT_FOR_TEXT_SCHEMA } from "./tools/browser-wait-for-text.js";

import type { BrowserScreenshotParams } from "./tools/browser-screenshot.js";
import type { BrowserReadParams } from "./tools/browser-read.js";
import type { BrowserClickParams } from "./tools/browser-click.js";
import type { BrowserTypeParams } from "./tools/browser-type.js";
import type { BrowserNavigateParams } from "./tools/browser-navigate.js";
import type { BrowserExecParams } from "./tools/browser-exec.js";
import type { BrowserWaitForElementParams } from "./tools/browser-wait-for-element.js";
import type { BrowserWaitForTextParams } from "./tools/browser-wait-for-text.js";

import { browserScreenshot } from "./tools/browser-screenshot.js";
import { browserRead } from "./tools/browser-read.js";
import { browserClick } from "./tools/browser-click.js";
import { browserType } from "./tools/browser-type.js";
import { browserNavigate } from "./tools/browser-navigate.js";
import { browserExec } from "./tools/browser-exec.js";
import { browserWaitForElement } from "./tools/browser-wait-for-element.js";
import { browserWaitForText } from "./tools/browser-wait-for-text.js";
import { start, stop } from "./server.js";

// ── TypeBox Schemas ──────────────────────────────────────────────────

const ScreenshotSchema = Type.Object(
  {
    format: Type.Optional(Type.Union([Type.Literal("png"), Type.Literal("jpeg")])),
    quality: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
    fullPage: Type.Optional(Type.Boolean()),
  },
  { default: { format: "png", quality: 80, fullPage: false } },
);

const ReadSchema = Type.Object(
  {
    selector: Type.Optional(Type.String()),
    maxLength: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { default: { maxLength: 50000 } },
);

const ClickSchema = Type.Object(
  {
    selector: Type.String(),
    text: Type.Optional(Type.String()),
    timeout: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { default: { timeout: 10000 } },
);

const TypeSchema = Type.Object(
  {
    selector: Type.String(),
    text: Type.String(),
    clear: Type.Optional(Type.Boolean()),
    submit: Type.Optional(Type.Boolean()),
    timeout: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { default: { clear: true, submit: false, timeout: 10000 } },
);

const NavigateSchema = Type.Object(
  {
    url: Type.String(),
    waitUntil: Type.Optional(
      Type.Union([Type.Literal("load"), Type.Literal("domcontentloaded"), Type.Literal("networkidle")]),
    ),
    timeout: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { default: { waitUntil: "load", timeout: 30000 } },
);

const ExecSchema = Type.Object({
  code: Type.String(),
});

const WaitForElementSchema = Type.Object(
  {
    selector: Type.String(),
    timeout: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { default: { timeout: 10000 } },
);

const WaitForTextSchema = Type.Object(
  {
    text: Type.String(),
    scope: Type.Optional(Type.String()),
    timeout: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { default: { timeout: 10000 } },
);

// ── Execute wrappers ─────────────────────────────────────────────────
//
// Our tool handlers use their own param interfaces and content block
// types (Anthropic-compatible). These thin wrappers bridge to pi's
// ToolDefinition shape by casting at the boundary.

function wrapResult(inner: { content: readonly { type: string }[] }): AgentToolResult<undefined> {
  return {
    content: inner.content as AgentToolResult<undefined>["content"],
    details: undefined,
  };
}

// ── Tool Definitions ─────────────────────────────────────────────────

const screenshotToolDef = defineTool({
  name: "browser_screenshot",
  label: "Browser Screenshot",
  description:
    "Capture a screenshot of the current browser tab. Returns a base64-encoded image in PNG or JPEG format.",
  parameters: ScreenshotSchema,
  async execute(_toolCallId, rawParams, _signal, _onUpdate, _ctx) {
    return wrapResult(await browserScreenshot(rawParams as BrowserScreenshotParams));
  },
});

const readToolDef = defineTool({
  name: "browser_read",
  label: "Browser Read",
  description:
    "Read the text content of the current browser tab. Can scope to a CSS selector or read the entire page body.",
  parameters: ReadSchema,
  async execute(_toolCallId, rawParams, _signal, _onUpdate, _ctx) {
    return wrapResult(await browserRead(rawParams as BrowserReadParams));
  },
});

const clickToolDef = defineTool({
  name: "browser_click",
  label: "Browser Click",
  description:
    "Click an element in the current browser tab identified by a CSS selector. Optionally disambiguate by text content.",
  parameters: ClickSchema,
  async execute(_toolCallId, rawParams, _signal, _onUpdate, _ctx) {
    return wrapResult(await browserClick(rawParams as BrowserClickParams));
  },
});

const typeToolDef = defineTool({
  name: "browser_type",
  label: "Browser Type",
  description:
    "Type text into an input element in the current browser tab. Can optionally clear existing value and submit the form.",
  parameters: TypeSchema,
  async execute(_toolCallId, rawParams, _signal, _onUpdate, _ctx) {
    return wrapResult(await browserType(rawParams as BrowserTypeParams));
  },
});

const waitForElementToolDef = defineTool({
  name: "browser_wait_for_element",
  label: "Browser Wait For Element",
  description:
    "Wait for an element matching a CSS selector to appear in the DOM. Returns timing info when found, or TIMEOUT error.",
  parameters: WaitForElementSchema,
  async execute(_toolCallId, rawParams, _signal, _onUpdate, _ctx) {
    return wrapResult(await browserWaitForElement(rawParams as BrowserWaitForElementParams));
  },
});

const waitForTextToolDef = defineTool({
  name: "browser_wait_for_text",
  label: "Browser Wait For Text",
  description:
    "Wait for specific text content to appear on the page. Optionally scope to a CSS selector. Returns timing info when found, or TIMEOUT error.",
  parameters: WaitForTextSchema,
  async execute(_toolCallId, rawParams, _signal, _onUpdate, _ctx) {
    return wrapResult(await browserWaitForText(rawParams as BrowserWaitForTextParams));
  },
});

const navigateToolDef = defineTool({
  name: "browser_navigate",
  label: "Browser Navigate",
  description:
    "Navigate the current browser tab to a URL. Supports waiting for page load, DOMContentLoaded, or network idle.",
  parameters: NavigateSchema,
  async execute(_toolCallId, rawParams, _signal, _onUpdate, _ctx) {
    return wrapResult(await browserNavigate(rawParams as BrowserNavigateParams));
  },
});

const execToolDef = defineTool({
  name: "browser_exec",
  label: "Browser Exec",
  description:
    "Execute arbitrary JavaScript in the page context and return the serialized result. Has a 5-second timeout.",
  parameters: ExecSchema,
  async execute(_toolCallId, rawParams, _signal, _onUpdate, _ctx) {
    return wrapResult(await browserExec(rawParams as BrowserExecParams));
  },
});

// ── Legacy exports (for direct import consumers) ─────────────────────

/** All pi ToolDefinition objects, also available for direct imports. */
export const tools = [
  screenshotToolDef,
  readToolDef,
  clickToolDef,
  typeToolDef,
  navigateToolDef,
  execToolDef,
  waitForElementToolDef,
  waitForTextToolDef,
] as const;

// ── Lifecycle Integration ────────────────────────────────────────────

/**
 * Default export for auto-loading by pi.
 * Registers all browser tools and manages the WebSocket server lifecycle.
 */
export default function (pi: ExtensionAPI): void {
  pi.registerTool(screenshotToolDef);
  pi.registerTool(readToolDef);
  pi.registerTool(clickToolDef);
  pi.registerTool(typeToolDef);
  pi.registerTool(navigateToolDef);
  pi.registerTool(execToolDef);
  pi.registerTool(waitForElementToolDef);
  pi.registerTool(waitForTextToolDef);

  pi.on("session_start", async () => {
    // start() reads PI_BROWSER_PORT env var, falling back to 9242 (FR-1).
    await start();
  });

  pi.on("session_shutdown", async () => {
    await stop();
  });
}
