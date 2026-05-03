/**
 * Chrome Tabs API wrappers.
 *
 * Wraps chrome.tabs.* calls behind plain functions so the rest of the
 * extension never accesses the chrome.tabs global directly. Also tracks
 * content-script injection state in a local Set<number>.
 *
 * Infrastructure layer — imports only from domain/.
 *
 * @module infrastructure/chrome-tabs
 */

import { sleep } from "../domain/index.js";

// ── Content-script injection tracking ────────────────────────────────────

const injectedTabs = new Set<number>();

/** Clear all injected tab state (for test setup). */
export function resetInjectedTabs(): void {
	injectedTabs.clear();
}

/** Mark a tab as having its content script verified. */
export function markInjected(tabId: number): void {
	injectedTabs.add(tabId);
}

/** Check whether we've already verified the content script in a tab. */
export function isInjected(tabId: number): boolean {
	return injectedTabs.has(tabId);
}

/** Remove a tab from the injection set (e.g. on tab close or reload). */
export function removeInjected(tabId: number): void {
	injectedTabs.delete(tabId);
}

// ── Active tab helpers ────────────────────────────────────────────────────

/**
 * Return the tab ID of the currently-active tab in the current window.
 * Returns null when no active tab exists.
 */
export async function getActiveTabId(): Promise<number | null> {
	try {
		const [tab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});
		return tab?.id ?? null;
	} catch {
		return null;
	}
}

/**
 * Return the URL of the currently-active tab, or null if unavailable.
 */
export async function getActiveTabUrl(): Promise<string | null> {
	try {
		const [tab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});
		return tab?.url ?? null;
	} catch {
		return null;
	}
}

/**
 * Return a tab descriptor by tab ID. Returns null if the tab
 * doesn't exist or the call fails.
 */
export async function getTab(tabId: number): Promise<chrome.tabs.Tab | null> {
	try {
		return await chrome.tabs.get(tabId);
	} catch {
		return null;
	}
}

// ── Tab creation helpers ────────────────────────────────────────────────

/**
 * Create a new tab and wait for it to reach `status: "complete"`.
 *
 * @param url — URL to open in the new tab. If omitted, opens a blank tab.
 * @param active — Whether the new tab should become the active tab. Defaults to `false`.
 * @returns The created tab descriptor.
 */
export async function createTab(
	url?: string,
	active = false,
): Promise<chrome.tabs.Tab> {
	const tab = await chrome.tabs.create({ url, active });
	if (!tab.id) {
		throw new Error("Created tab has no id");
	}
	return tab;
}

// ── Tab update helpers ────────────────────────────────────────────────────

/**
 * Navigate a tab to the given URL. Returns the updated tab descriptor.
 */
export async function updateTab(
	tabId: number,
	url: string,
): Promise<chrome.tabs.Tab | undefined> {
	return chrome.tabs.update(tabId, { url });
}

/**
 * List all open tabs with optional filtering.
 *
 * @param urlPattern — Filter tabs whose URL contains this substring.
 * @param currentWindowOnly — Only return tabs in the current window. Defaults to `true`.
 * @returns Array of tab descriptors with id, url, title, and active status.
 */
export async function listTabs(
	urlPattern?: string,
	currentWindowOnly = true,
): Promise<
	Array<{ tabId: number; url: string; title: string; active: boolean }>
> {
	const tabs = await chrome.tabs.query({
		currentWindow: currentWindowOnly,
	});

	return tabs
		.filter((tab): tab is chrome.tabs.Tab & { id: number; url: string } =>
			tab.id !== undefined && tab.url !== undefined,
		)
		.map((tab) => ({
			tabId: tab.id,
			url: tab.url,
			title: tab.title ?? "",
			active: tab.active ?? false,
		}))
		.filter((tab) => {
			if (!urlPattern) return true;
			return (
				tab.url.includes(urlPattern) || tab.title.includes(urlPattern)
			);
		});
}

/**
 * Close a tab by its ID.
 *
 * @param tabId — ID of the tab to close.
 * @returns `true` if the tab was successfully closed.
 * @throws If the tab doesn't exist (callers should check with `getTab` first).
 */
export async function closeTab(tabId: number): Promise<boolean> {
	await chrome.tabs.remove(tabId);
	removeInjected(tabId);
	return true;
}

// ── Screenshot helpers ────────────────────────────────────────────────────

/**
 * Capture the visible area of the current window.
 *
 * @param format — Image format ("png" or "jpeg"). Default "png".
 * @param quality — JPEG quality (0‑100). Ignored for PNG.
 * @returns A `data:` URL string.
 */
export async function captureVisibleTab(
	format?: "png" | "jpeg",
	quality?: number,
): Promise<string> {
	const options: { format?: "png" | "jpeg"; quality?: number } = {};
	if (format) options.format = format;
	if (quality !== undefined) options.quality = quality;
	return chrome.tabs.captureVisibleTab(options);
}

// ── Scripting helpers ─────────────────────────────────────────────────────

/**
 * Execute a function inside a tab and return its result.
 */
export async function executeScriptInTab<T>(
	tabId: number,
	func: () => T,
): Promise<chrome.scripting.InjectionResult<chrome.scripting.Awaited<T>>[]> {
	return chrome.scripting.executeScript<[], T>({
		target: { tabId },
		func,
	});
}

// ── Content script communication ──────────────────────────────────────────

/**
 * Send a message to the content script in the given tab.
 *
 * @param tabId — Target tab.
 * @param message — Message payload.
 * @param timeoutMs — Default 30 s.
 * @returns The content script's response, or rejects on timeout / failure.
 */
export async function sendMessageToTab(
	tabId: number,
	message: unknown,
	timeoutMs = 30_000,
): Promise<unknown> {
	return Promise.race([
		chrome.tabs.sendMessage(tabId, message),
		new Promise<never>((_, reject) =>
			setTimeout(
				() => reject(new Error("Content script request timed out")),
				timeoutMs,
			),
		),
	]);
}

/** Verify the content script is loaded by sending a lightweight ping. */
export async function ensureContentScript(tabId: number): Promise<void> {
	// Skip if we've already verified this tab.
	if (isInjected(tabId)) return;

	try {
		await sendMessageToTab(tabId, { type: "ping" }, 5_000);
		markInjected(tabId);
	} catch {
		// The content script is not injected (e.g. chrome:// pages, extensions
		// pages, or the tab hasn't fully loaded yet).
		removeInjected(tabId);
		throw new Error(
			`Content script not available in tab ${tabId}. The page may be a restricted URL or still loading.`,
		);
	}
}

// ── Forward to content script with retry ──────────────────────────────────

/**
 * Forward a request to the content script with up to `maxRetries` retries
 * on transient failures (tab reload, content-script re-injection).
 */
export async function forwardToContentScript(
	tabId: number,
	request: { id: string; action: string; params?: unknown },
	maxRetries = 2,
): Promise<{
	id: string;
	result?: { tabId: number } & Record<string, unknown>;
	error?: { code: string; message: string; suggestion?: string; tabId?: number };
}> {
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			await ensureContentScript(tabId);
		} catch (e) {
			const err = e instanceof Error ? e.message : String(e);
			if (attempt < maxRetries) {
				await sleep(300);
				continue;
			}
			return {
				id: request.id,
				error: {
					code: "BROWSER_NOT_CONNECTED",
					message: err,
					tabId,
				},
			};
		}

		try {
			const response = await sendMessageToTab(tabId, request);

			if (
				response &&
				typeof response === "object" &&
				"id" in (response as object)
			) {
				const resp = response as {
					id: string;
					result?: { tabId: number } & Record<string, unknown>;
					error?: { code: string; message: string; suggestion?: string; tabId?: number };
				};
				// Error responses pass through unchanged.
				if (resp.error) {
					return resp;
				}
				// Inject tabId into the result payload.
				if (resp.result && typeof resp.result === "object") {
					return { ...resp, result: { tabId, ...(resp.result as Record<string, unknown>) } };
				}
				return { ...resp, result: { tabId } };
			}

			return {
				id: request.id,
				error: {
					code: "UNKNOWN_ACTION",
					message: "Invalid response from content script",
					suggestion:
						"The content script returned an unexpected response shape. Check the browser console for details.",
					tabId,
				},
			};
		} catch (e) {
			const err = e instanceof Error ? e.message : String(e);

			// If the tab was closed, no point retrying.
			if (
				err.includes("Receiving end does not exist") ||
				err.includes("closed")
			) {
				removeInjected(tabId);
				return {
					id: request.id,
					error: {
						code: "TAB_NOT_FOUND",
						message: `Tab ${tabId} does not exist or has been closed.`,
						suggestion: "Use listTabs to find a valid tabId.",
						tabId,
					},
				};
			}

			// Connection reset / port closed — retry if attempts remain.
			if (
				attempt < maxRetries &&
				(err.includes("Could not establish connection") ||
					err.includes("port") ||
					err.includes("timed out"))
			) {
				removeInjected(tabId); // Force re-verification
				await sleep(300);
				continue;
			}

			return {
				id: request.id,
				error: {
					code: "UNKNOWN_ACTION",
					message: err,
					suggestion:
						"Check that the content script is loaded and the tab has a compatible page (not a restricted URL like chrome://).",
					tabId,
				},
			};
		}
	}

	// Should never reach here — all paths return above.
	return {
		id: request.id,
		error: {
			code: "UNKNOWN_ACTION",
			message: "Forward failed after all retries.",
			tabId,
		},
	};
}

// ── Navigation helpers ────────────────────────────────────────────────────

/**
 * Wait for a tab to reach `status: "complete"`.
 *
 * Uses `chrome.tabs.onUpdated` to detect when a specific tab finishes
 * loading. Times out after `timeoutMs`.
 */
export function waitForTabComplete(
	tabId: number,
	timeoutMs: number,
): Promise<void> {
	return new Promise((resolve, reject) => {
		let resolved = false;

		const timer = setTimeout(() => {
			if (resolved) return;
			resolved = true;
			chrome.tabs.onUpdated.removeListener(listener);
			reject(
				new Error(`Tab ${tabId} did not finish loading within ${timeoutMs}ms`),
			);
		}, timeoutMs);

		function listener(
			updatedTabId: number,
			changeInfo: chrome.tabs.OnUpdatedInfo,
		) {
			if (updatedTabId !== tabId) return;
			if (changeInfo.status === "complete") {
				if (resolved) return;
				resolved = true;
				clearTimeout(timer);
				chrome.tabs.onUpdated.removeListener(listener);
				resolve();
			}
		}

		chrome.tabs.onUpdated.addListener(listener);
	});
}

// ── URL validation ────────────────────────────────────────────────────────

/** Re-exported from domain layer. */
export { isRestrictedUrl } from "../domain/screenshot.js";
