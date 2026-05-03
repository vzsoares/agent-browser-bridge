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
  ErrorCode,
  ErrorResponse,
  ErrorCategory,
} from "./errors.js";
export {
  categorizeErrorCode,
  isRetryable,
  createTimeoutError,
  createNotConnectedError,
  createSendFailedError,
  createOwnerNotConnectedError,
  createOwnerUnreachableError,
} from "./errors.js";

// ── Schemas ────────────────────────────────────────────────────────────────

export {
  NavigateSchema,
  ClickSchema,
  TypeSchema,
  ScreenshotSchema,
  ReadSchema,
  ExecSchema,
  WaitForElementSchema,
  WaitForTextSchema,
} from "./schemas.js";
export type {
  ValidatedNavigateParams,
  ValidatedClickParams,
  ValidatedTypeParams,
  ValidatedScreenshotParams,
  ValidatedReadParams,
  ValidatedExecParams,
  ValidatedWaitForElementParams,
  ValidatedWaitForTextParams,
} from "./schemas.js";

// ── Allowlist ──────────────────────────────────────────────────────────────

export {
  RESTRICTED_URL_RE,
  RESTRICTED_SCHEMES,
  validateUrl,
  extractHostname,
  checkDomain,
} from "./allowlist.js";
export type {
  UrlValid,
  UrlInvalid,
  UrlValidation,
  DomainAllowed,
  DomainBlocked,
  DomainCheck,
} from "./allowlist.js";

// ── Ports ──────────────────────────────────────────────────────────────────

export type {
  BridgeTransport,
  ServerHandle,
  ServerLifecycle,
  AllowlistStore,
  NotificationSink,
} from "./ports.js";
