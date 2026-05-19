/**
 * Domain layer barrel export.
 *
 * This module exports all domain types, schemas, and logic. It has zero
 * imports from infrastructure packages (Hono, ws, pi SDK). The only
 * external dependencies are TypeScript built-ins, the protocol types,
 * and zod (for runtime schema validation).
 *
 * @module domain
 */

// ── Errors ─────────────────────────────────────────────────────────────────

export type {
	ErrorCategory,
	ErrorCode,
	ErrorResponse,
} from "./errors.js";
export {
	categorizeErrorCode,
	createNotConnectedError,
	createOwnerNotConnectedError,
	createOwnerUnreachableError,
	createSendFailedError,
	createTimeoutError,
	isRetryable,
} from "./errors.js";

// ── Schemas ────────────────────────────────────────────────────────────────

export type {
	ValidatedClickParams,
	ValidatedExecParams,
	ValidatedNavigateParams,
	ValidatedReadParams,
	ValidatedScreenshotParams,
	ValidatedTypeParams,
	ValidatedWaitForElementParams,
	ValidatedWaitForTextParams,
} from "./schemas.js";
export {
	ClickSchema,
	ExecSchema,
	NavigateSchema,
	ReadSchema,
	ScreenshotSchema,
	TypeSchema,
	WaitForElementSchema,
	WaitForTextSchema,
} from "./schemas.js";

// ── Allowlist ──────────────────────────────────────────────────────────────

export type {
	DomainAllowed,
	DomainBlocked,
	DomainCheck,
	UrlInvalid,
	UrlValid,
	UrlValidation,
} from "./allowlist.js";
export {
	checkDomain,
	extractHostname,
	RESTRICTED_SCHEMES,
	RESTRICTED_URL_RE,
	validateUrl,
} from "./allowlist.js";

// ── Ports ──────────────────────────────────────────────────────────────────

export type {
	AllowlistStore,
	BridgeTransport,
	NotificationSink,
	ServerHandle,
	ServerLifecycle,
} from "./ports.js";
