/**
 * @pi-browser-bridge/protocol — barrel export
 *
 * Re-exports every type and interface from the shared protocol module.
 * Import from `@pi-browser-bridge/protocol` to get all types.
 */

export type {
  Action,
  ActionParams,
  ClickParams,
  CloseTabParams,
  CreateTabParams,
  ErrorCode,
  ErrorResponse,
  ExecParams,
  ExecResult,
  ListTabsParams,
  NavigateParams,
  ReadParams,
  Request,
  Response,
  ScreenshotParams,
  TypeParams,
  WaitForElementParams,
  WaitForTextParams,
} from "./protocol.js";
