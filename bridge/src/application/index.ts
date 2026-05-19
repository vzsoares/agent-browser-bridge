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

export { handleResponse } from "./handle-response.js";
export { sendRequest } from "./send-request.js";

// ── Shared types ───────────────────────────────────────────────────────────

export type {
	ClickResult,
	CloseTabResult,
	CreateTabResult,
	ExecResult,
	ListTabsResult,
	NavigateResult,
	ReadResult,
	ScreenshotResult,
	TabDescriptor,
	TypeResult,
	UseCaseError,
	UseCaseResult,
	UseCaseSuccess,
	WaitForElementResult,
	WaitForTextResult,
} from "./types.js";

// ── Use cases ──────────────────────────────────────────────────────────────

export { executeClickUseCase } from "./click-usecase.js";
export { executeCloseTabUseCase } from "./close-tab-usecase.js";
export { executeCreateTabUseCase } from "./create-tab-usecase.js";
export { executeExecUseCase } from "./exec-usecase.js";
export { executeListTabsUseCase } from "./list-tabs-usecase.js";
export { executeNavigateUseCase } from "./navigate-usecase.js";
export { executeReadUseCase } from "./read-usecase.js";
export { executeScreenshotUseCase } from "./screenshot-usecase.js";
export { executeTypeUseCase } from "./type-usecase.js";
export { executeWaitForElementUseCase } from "./wait-for-element-usecase.js";
export { executeWaitForTextUseCase } from "./wait-for-text-usecase.js";
