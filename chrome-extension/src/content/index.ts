/**
 * Content script entry point — injected by manifest into every page.
 *
 * Creates a `chrome.runtime.onMessage` listener that delegates all
 * action handling to the application layer dispatcher. The message
 * listener infrastructure lives in `infrastructure/content-listener.ts`.
 *
 * This file is the single entry point referenced by manifest.json.
 * The manifest auto-injects it via `<all_urls>`.
 *
 * @module content
 */

import { createLogger } from "@pi-browser-bridge/logger";
import { dispatch } from "../application/dispatcher.js";
import { matchDomain } from "../domain/allowlist.js";
import { createContentListener } from "../infrastructure/content-listener.js";

const logger = createLogger("chrome-ext:content");
logger.info("Content script injected");

// ── Domain allowlist storage key ───────────────────────────────────────

const ALLOWLIST_STORAGE_KEY = "domainAllowlist";

/**
 * Read the domain allowlist from chrome.storage.local.
 * Used by the defence-in-depth check in the content listener.
 */
async function getAllowlist(): Promise<string[]> {
	try {
		const stored = (await chrome.storage.local.get(
			ALLOWLIST_STORAGE_KEY,
		)) as Record<string, unknown>;
		const raw = stored[ALLOWLIST_STORAGE_KEY];
		if (
			Array.isArray(raw) &&
			raw.length > 0 &&
			raw.every((v): v is string => typeof v === "string")
		) {
			return raw;
		}
	} catch {
		// Storage unavailable — fail open.
	}
	return ["*"];
}

// ── Register the message listener ──────────────────────────────────────

createContentListener({
	dispatch,
	matchDomain,
	getAllowlist,
	logger,
});
