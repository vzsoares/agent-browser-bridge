/**
 * Screenshot action handler — orchestrate screenshot capture.
 *
 * Validates parameters using domain logic, checks URL restrictions,
 * and delegates the actual screen capture to the provided infrastructure
 * functions via dependency injection.
 *
 * Pure application logic — zero Chrome API dependencies. The caller
 * injects the platform-specific capture function via {@link ScreenshotDependencies}.
 *
 * @module application/handle-screenshot
 */

import type { Response } from "@pi-browser-bridge/protocol";
import {
	isRestrictedUrl,
	validateScreenshotParams,
	type ScreenshotValidationError,
} from "../domain/screenshot.js";

// ── Dependency injection interface ──────────────────────────────────────

/** Infrastructure dependencies injected by the caller. */
export interface ScreenshotDependencies {
	/** Capture the visible area of the active tab. Returns a `data:` URL. */
	captureVisibleTab: (
		format: "png" | "jpeg",
		quality?: number,
	) => Promise<string>;
	/** Read the current active tab's URL (for restriction checks). */
	getActiveTabUrl: () => Promise<string | null>;
}

// ── Handler ─────────────────────────────────────────────────────────────

/**
 * Orchestrate a screenshot capture.
 *
 * 1. Validate parameters via domain logic.
 * 2. Check URL restrictions (block chrome://, edge://, etc.).
 * 3. Delegate the capture to the injected {@link ScreenshotDependencies.captureVisibleTab}.
 * 4. Return the base64-encoded image data.
 *
 * @param id — Request correlation ID.
 * @param params — Raw screenshot parameters (format?, quality?, fullPage?).
 * @param deps — Infrastructure dependencies.
 * @returns A protocol Response with either the image data or a structured error.
 */
export async function handleScreenshot(
	id: string,
	params: unknown,
	deps: ScreenshotDependencies,
): Promise<Response> {
	// ── 1. Validate parameters ──────────────────────────────────────────
	const validated = validateScreenshotParams(params);

	if ("code" in validated) {
		const err = validated as ScreenshotValidationError;
		return {
			id,
			error: {
				code: "UNKNOWN_ACTION" as const,
				message: err.message,
				...(err.suggestion ? { suggestion: err.suggestion } : {}),
			},
		};
	}

	// ── 2. Check URL restrictions ───────────────────────────────────────
	try {
		const tabUrl = await deps.getActiveTabUrl();
		if (tabUrl && isRestrictedUrl(tabUrl)) {
			return {
				id,
				error: {
					code: "RESTRICTED_URL",
					message: `Cannot capture screenshots of restricted pages: ${tabUrl}`,
					suggestion:
						"Navigate to a regular web page (https://…) and try again.",
				},
			};
		}
	} catch {
		// If we can't read the tab URL, proceed with best-effort capture.
	}

	// ── 3. Capture ──────────────────────────────────────────────────────
	const quality =
		validated.format === "jpeg" ? (validated.quality ?? 80) : undefined;

	try {
		const dataUrl = await deps.captureVisibleTab(validated.format, quality);
		const base64 = dataUrl.split(",")[1] ?? dataUrl;

		const warning = validated.fullPage
			? "Full-page screenshot is viewport-only in v1. Only the visible viewport was captured. Use your own scrolling + stitching logic for true full-page captures."
			: undefined;

		return {
			id,
			result: {
				data: base64,
				format: validated.format,
				...(warning ? { warning } : {}),
			},
		};
	} catch (e) {
		const err = e instanceof Error ? e.message : String(e);

		if (
			err.includes("Cannot access") ||
			err.includes("chrome://") ||
			err.includes("restricted") ||
			err.includes("not allowed")
		) {
			return {
				id,
				error: {
					code: "RESTRICTED_URL",
					message: "Screenshot blocked — the page may be a restricted URL.",
					suggestion:
						"Navigate to a regular web page (https://…) and try again.",
				},
			};
		}

		return {
			id,
			error: { code: "UNKNOWN_ACTION", message: `Screenshot failed: ${err}` },
		};
	}
}
