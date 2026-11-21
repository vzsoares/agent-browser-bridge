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

import type { Response } from "@agent-browser-bridge/protocol";
import {
	isRestrictedUrl,
	type ScreenshotValidationError,
	validateScreenshotParams,
} from "../domain/screenshot.js";

// ── Dependency injection interface ──────────────────────────────────────

/** Minimal tab descriptor needed for a targeted capture. */
export interface TabInfo {
	url: string | null;
	windowId: number;
	active: boolean;
}

/** Infrastructure dependencies injected by the caller. */
export interface ScreenshotDependencies {
	/** Capture the visible area of the active tab. Returns a `data:` URL. */
	captureVisibleTab: (
		format: "png" | "jpeg",
		quality?: number,
		windowId?: number,
	) => Promise<string>;
	/** Look up a tab by ID; null when it does not exist. */
	getTab: (tabId: number) => Promise<TabInfo | null>;
	/** Make a tab the active tab of its window. */
	activateTab: (tabId: number) => Promise<void>;
	/** The active tab ID of the given window. */
	getActiveTabIdInWindow: (windowId: number) => Promise<number | null>;
	/** Read the current active tab's URL (for restriction checks). */
	getActiveTabUrl: () => Promise<string | null>;
	/** The active tab ID to include in response payloads. */
	activeTabId: number;
}

// ── Handler ─────────────────────────────────────────────────────────────

/**
 * Orchestrate a screenshot capture.
 *
 * 1. Validate parameters via domain logic.
 * 2. Check URL restrictions (block chrome://, edge://, etc.).
 * 3. With a `tabId`, activate that tab (captureVisibleTab only sees the
 *    active tab) and restore the previously active tab afterwards.
 * 4. Delegate the capture to the injected {@link ScreenshotDependencies.captureVisibleTab}.
 * 5. Return the base64-encoded image data.
 *
 * @param id — Request correlation ID.
 * @param params — Raw screenshot parameters (tabId?, format?, quality?, fullPage?).
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

	// ── 2. Resolve target tab ───────────────────────────────────────────
	let targetTabId = deps.activeTabId;
	let targetTab: TabInfo | null = null;
	if (validated.tabId !== undefined) {
		targetTabId = validated.tabId;
		targetTab = await deps.getTab(validated.tabId);
		if (!targetTab) {
			return {
				id,
				error: {
					code: "TAB_NOT_FOUND",
					message: `No tab with id ${validated.tabId}.`,
					suggestion: "The tab may have been closed. List tabs for valid ids.",
				},
			};
		}
	}

	// ── 3. Check URL restrictions ───────────────────────────────────────
	try {
		const tabUrl = targetTab ? targetTab.url : await deps.getActiveTabUrl();
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

	// ── 4. Capture ──────────────────────────────────────────────────────
	const quality =
		validated.format === "jpeg" ? (validated.quality ?? 80) : undefined;

	let restoreTabId: number | null = null;
	try {
		if (targetTab && !targetTab.active) {
			restoreTabId = await deps.getActiveTabIdInWindow(targetTab.windowId);
			await deps.activateTab(targetTabId);
			// Let the newly activated tab paint before capture.
			await new Promise((resolve) => setTimeout(resolve, 150));
		}
		const dataUrl = targetTab
			? await deps.captureVisibleTab(
					validated.format,
					quality,
					targetTab.windowId,
				)
			: await deps.captureVisibleTab(validated.format, quality);
		const base64 = dataUrl.split(",")[1] ?? dataUrl;

		const warning = validated.fullPage
			? "Full-page screenshot is viewport-only in v1. Only the visible viewport was captured. Use your own scrolling + stitching logic for true full-page captures."
			: undefined;

		return {
			id,
			result: {
				tabId: targetTabId,
				data: base64,
				format: validated.format,
				...(warning ? { warning } : {}),
			},
		};
	} catch (e: unknown) {
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
	} finally {
		if (restoreTabId !== null) {
			await deps.activateTab(restoreTabId).catch(() => undefined);
		}
	}
}
