/**
 * Shared types for the chrome-extension application layer.
 *
 * Defines the discriminated-union result pattern used by all action handlers.
 * Zero dependencies on Chrome APIs or infrastructure packages.
 *
 * @module application/types
 */

import type { ErrorCode, ErrorResponse } from "@agent-browser-bridge/protocol";

// ── Handler result ─────────────────────────────────────────────────────────

/** Successful handler outcome. */
export interface HandlerSuccess<T> {
	success: true;
	/** The domain-level result data. */
	data: T;
}

/** Failed handler outcome with a structured protocol error. */
export interface HandlerError {
	success: false;
	/** Structured error from either transport or the browser extension. */
	error: ErrorResponse;
}

/**
 * Discriminated union for every handler return value.
 *
 * Handlers never throw — they always return a result that the caller
 * can inspect via `.success`.
 */
export type HandlerResult<T> = HandlerSuccess<T> | HandlerError;

// ── Tool-specific result types ─────────────────────────────────────────────

/** Navigate success result. */
export interface NavigateSuccess {
	/** Final URL after navigation. */
	url: string;
	/** Document title. */
	title: string;
}

/** Click success result (mirrors domain ClickSuccess). */
export interface ClickSuccessResult {
	clicked: true;
	selector: string;
	text: string;
	navigated: boolean;
	newTitle?: string;
	newUrl?: string;
}

/** Click error result (mirrors domain ClickError). */
export interface ClickErrorResult {
	clicked: false;
	code: string;
	message: string;
	suggestions?: string[];
}

/** Union of possible click outcomes. */
export type ClickResult = ClickSuccessResult | ClickErrorResult;

/** Type success result (mirrors domain TypeSuccess). */
export interface TypeSuccessResult {
	typed: true;
	selector: string;
	value: string;
}

/** Type error result (mirrors domain TypeErrorResult). */
export interface TypeErrorResultData {
	typed: false;
	selector: string;
	error: string;
	message: string;
	tag?: string;
	suggestions?: string;
}

/** Union of possible type outcomes. */
export type TypeActionResult = TypeSuccessResult | TypeErrorResultData;

/** Read result (mirrors domain ExtractTextResult). */
export interface ReadSuccess {
	text: string;
	length: number;
	truncated: boolean;
}

/** Screenshot success result (base64-encoded image data). */
export interface ScreenshotSuccess {
	/** Base64-encoded image data (without the `data:…` prefix). */
	data: string;
	/** Image format. */
	format: "png" | "jpeg";
	/** Optional warning (e.g. fullPage not supported in v1). */
	warning?: string;
}

/** Exec success result. */
export interface ExecSuccess {
	/** Raw return value (unserialised — may contain non-transferable types). */
	value: unknown;
	/** Human-readable serialised representation safe for display. */
	serialized: string;
}

/** Wait-for-element success result. */
export interface WaitForElementSuccess {
	found: true;
	elapsedMs: number;
	selector: string;
	tagName: string;
}

/** Wait-for-element timeout result. */
export interface WaitForElementError {
	found: false;
	elapsedMs: number;
	selector: string;
	error: ErrorCode;
	message: string;
}

/** Union of possible wait-for-element outcomes. */
export type WaitForElementActionResult =
	| WaitForElementSuccess
	| WaitForElementError;

/** Wait-for-text success result. */
export interface WaitForTextSuccess {
	found: true;
	elapsedMs: number;
	text: string;
}

/** Wait-for-text timeout result. */
export interface WaitForTextError {
	found: false;
	elapsedMs: number;
	text: string;
	error: ErrorCode;
	message: string;
}

/** Union of possible wait-for-text outcomes. */
export type WaitForTextActionResult = WaitForTextSuccess | WaitForTextError;
