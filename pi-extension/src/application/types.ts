/**
 * Shared types for the application layer.
 *
 * Defines the discriminated-union result pattern used by all use cases
 * and orchestration utilities. Zero dependencies on infrastructure.
 *
 * @module application/types
 */

import type { ErrorResponse } from "@pi-browser-bridge/protocol";

// ── Use case result ────────────────────────────────────────────────────────

/** Successful use case outcome. */
export interface UseCaseSuccess<T> {
  success: true;
  /** The domain-level result data. */
  data: T;
}

/** Failed use case outcome with a structured protocol error. */
export interface UseCaseError {
  success: false;
  /** Structured error from either transport or the browser extension. */
  error: ErrorResponse;
}

/**
 * Discriminated union for every use case return value.
 *
 * Use cases never throw — they always return a result that the caller
 * can inspect via `.success`.
 */
export type UseCaseResult<T> = UseCaseSuccess<T> | UseCaseError;

// ── Tool-specific result types ─────────────────────────────────────────────

/** Navigate use case result. */
export interface NavigateResult {
  url: string;
  title: string;
}

/** Click use case success result. */
export interface ClickResult {
  clicked: true;
  selector: string;
  text: string;
  navigated: boolean;
  newTitle?: string;
  newUrl?: string;
}

/** Type use case result. */
export interface TypeResult {
  typed: boolean;
  selector: string;
  value: string;
  suggestions?: string;
}

/** Screenshot use case result. */
export interface ScreenshotResult {
  data: string;
  format: "png" | "jpeg";
  warning?: string;
}

/** Read use case result. */
export interface ReadResult {
  text: string;
  length: number;
  truncated?: boolean;
}

/** Exec use case result. */
export interface ExecResult {
  serialized: string;
}

/** Wait-for-element use case success result. */
export interface WaitForElementResult {
  found: true;
  elapsedMs: number;
  selector: string;
  tagName: string;
}

/** Wait-for-text use case success result. */
export interface WaitForTextResult {
  found: true;
  elapsedMs: number;
  text: string;
}
