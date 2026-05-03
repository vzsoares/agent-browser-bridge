/**
 * Application layer barrel export.
 *
 * This module exports all action handlers and the message dispatcher.
 * The application layer depends only on the domain layer. It has zero
 * imports from infrastructure packages (Chrome APIs, logger, WebSocket, etc.).
 *
 * @module application
 */

// ── Dispatcher ──────────────────────────────────────────────────────────────

export { dispatch, ALL_ACTIONS } from "./dispatcher.js";

// ── Action handlers ─────────────────────────────────────────────────────────

export { handleClick } from "./handle-click.js";
export { handleExec } from "./handle-exec.js";
export { handleNavigate } from "./handle-navigate.js";
export { handleRead } from "./handle-read.js";
export { handleScreenshot } from "./handle-screenshot.js";
export type { ScreenshotDependencies } from "./handle-screenshot.js";
export { handleType } from "./handle-type.js";
export { handleWaitForElement } from "./handle-wait-for-element.js";
export { handleWaitForText } from "./handle-wait-for-text.js";

// ── Shared types ────────────────────────────────────────────────────────────

export type {
  HandlerSuccess,
  HandlerError,
  HandlerResult,
  NavigateSuccess,
  ClickSuccessResult,
  ClickErrorResult,
  ClickResult,
  TypeSuccessResult,
  TypeErrorResultData,
  TypeActionResult,
  ReadSuccess,
  ScreenshotSuccess,
  ExecSuccess,
  WaitForElementSuccess,
  WaitForElementError,
  WaitForElementActionResult,
  WaitForTextSuccess,
  WaitForTextError,
  WaitForTextActionResult,
} from "./types.js";
