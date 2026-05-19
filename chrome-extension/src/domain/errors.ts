/**
 * Domain-level error types for DOM operations.
 *
 * These are pure TypeScript types — zero runtime dependencies, zero Chrome API
 * dependencies, fully testable with happy-dom.
 *
 * @module domain/errors
 */

import type { ErrorCode } from "@agent-browser-bridge/protocol";

// Re-export ErrorCode from protocol for convenience (protocol is a
// shared types package — allowed in the domain layer).
export type { ErrorCode };

/** Structured error shape returned by domain functions. */
export interface DomainError {
	/** Machine-readable error code. */
	code: ErrorCode;
	/** Human-readable error message. */
	message: string;
	/** Optional actionable hint. */
	suggestion?: string;
}

/** Union of all domain error codes specific to the DOM layer. */
export type DomErrorCode =
	| "TIMEOUT"
	| "ELEMENT_NOT_FOUND"
	| "ELEMENT_NOT_INTERACTABLE"
	| "ELEMENT_NOT_TYPABLE";

/** Factory helpers for common domain errors. */

export function timeoutError(
	message: string,
	suggestion?: string,
): DomainError {
	return { code: "TIMEOUT", message, suggestion };
}

export function elementNotFoundError(
	message: string,
	suggestion?: string,
): DomainError {
	return { code: "ELEMENT_NOT_FOUND", message, suggestion };
}

export function elementNotInteractableError(
	message: string,
	suggestion?: string,
): DomainError {
	return { code: "ELEMENT_NOT_INTERACTABLE", message, suggestion };
}

export function elementNotTypableError(
	message: string,
	suggestion?: string,
): DomainError {
	return { code: "ELEMENT_NOT_TYPABLE", message, suggestion };
}
