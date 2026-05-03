/**
 * Application layer barrel export.
 *
 * This module exports all use cases and orchestration utilities.
 * The application layer depends only on the domain layer (ports, schemas,
 * allowlist, errors) and the shared protocol types. It has zero imports
 * from Hono, ws, or the pi SDK.
 *
 * @module application
 */

// ── Orchestration utilities ────────────────────────────────────────────────

export { sendRequest } from "./send-request.js";
export { handleResponse } from "./handle-response.js";

// ── Shared types ───────────────────────────────────────────────────────────

export type {
  UseCaseSuccess,
  UseCaseError,
  UseCaseResult,
  NavigateResult,
  ClickResult,
  TypeResult,
  ScreenshotResult,
  ReadResult,
  ExecResult,
  WaitForElementResult,
  WaitForTextResult,
} from "./types.js";

// ── Use cases ──────────────────────────────────────────────────────────────

export { executeNavigateUseCase } from "./navigate-usecase.js";
export { executeClickUseCase } from "./click-usecase.js";
export { executeTypeUseCase } from "./type-usecase.js";
export { executeScreenshotUseCase } from "./screenshot-usecase.js";
export { executeReadUseCase } from "./read-usecase.js";
export { executeExecUseCase } from "./exec-usecase.js";
export { executeWaitForElementUseCase } from "./wait-for-element-usecase.js";
export { executeWaitForTextUseCase } from "./wait-for-text-usecase.js";
