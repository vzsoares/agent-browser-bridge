/**
 * Navigate action handler — navigate the browser tab to a URL.
 *
 * Handles same-page (hash-only) navigation with full waitUntil support
 * using pure DOM APIs. Cross-page navigation is initiated via
 * `window.location.href` — the service worker handles the post-navigation
 * lifecycle.
 *
 * Pure application logic — zero Chrome API dependencies (uses only
 * `window.location`, `document`, and standard DOM events).
 *
 * @module application/handle-navigate
 */

import {
	sleep,
	withTimeout,
} from "../domain/index.js";
import { isRestrictedUrl } from "../domain/screenshot.js";
import type { ErrorResponse } from "@pi-browser-bridge/protocol";

// ── Result union ────────────────────────────────────────────────────────────

/** Successful navigation result. */
interface NavigateSuccessResult {
  /** Final URL after navigation. */
  url: string;
  /** Document title. */
  title: string;
}

/** Result indicating a cross-page navigation was initiated. */
interface NavigateCrossPage {
  /** Sentinel — the content script was destroyed by this navigation. */
  status: "navigating";
  /** Target URL. */
  url: string;
}

/** Union of possible navigate outcomes from the content script. */
type NavigateResult = NavigateSuccessResult | NavigateCrossPage | ErrorResponse;

// ── Wait helpers ────────────────────────────────────────────────────────────

/**
 * Return a promise that resolves on the next `hashchange` event.
 */
function waitForHashChange(): Promise<void> {
  return new Promise((resolve) => {
    function listener() {
      window.removeEventListener("hashchange", listener);
      resolve();
    }
    window.addEventListener("hashchange", listener);
  });
}

/**
 * Wait for a single DOM event on `window` with a timeout.
 */
function waitForEvent(eventName: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener(eventName, listener);
      reject(new Error(`Timed out waiting for ${eventName} after ${timeoutMs}ms`));
    }, timeoutMs);

    function listener() {
      clearTimeout(timer);
      window.removeEventListener(eventName, listener);
      resolve();
    }

    window.addEventListener(eventName, listener);
  });
}

/**
 * Poll `performance.getEntriesByType('resource')` until 500ms pass with no
 * new entries, or the timeout is reached.
 */
async function waitForNetworkIdle(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const QUIET_MS = 500;

  while (Date.now() < deadline) {
    const before = performance.getEntriesByType("resource").length;
    await sleep(QUIET_MS);

    if (Date.now() >= deadline) return;

    const after = performance.getEntriesByType("resource").length;
    if (after === before) {
      // No new entries for QUIET_MS — network is idle.
      return;
    }
    // New entries appeared — keep polling.
  }
  // Timeout exceeded — resolve anyway so we return partial results.
}

/**
 * Wait for a specific page-load lifecycle event.
 */
function waitForLoadEvent(
  waitUntil: string,
  timeoutMs: number,
): Promise<void> {
  if (waitUntil === "load") {
    return waitForEvent("load", timeoutMs);
  }

  if (waitUntil === "domcontentloaded") {
    if (
      document.readyState === "interactive" ||
      document.readyState === "complete"
    ) {
      return Promise.resolve();
    }
    return waitForEvent("DOMContentLoaded", timeoutMs);
  }

  // "networkidle" — poll resource timing entries
  return waitForNetworkIdle(timeoutMs);
}

// ── Same-page navigation ────────────────────────────────────────────────────

/**
 * Handle same-page (hash-only) navigation with full waitUntil support.
 */
async function handleSamePageNavigation(
  targetHash: string,
  waitUntil: string,
  timeoutMs: number,
): Promise<NavigateSuccessResult> {
  window.location.hash = targetHash;

  // If the hash is empty, we're already at the target.
  if (!targetHash || targetHash === "#") {
    return {
      url: window.location.href,
      title: document.title,
    };
  }

  // Wait for the hashchange event to fire, then apply waitUntil.
  try {
    await withTimeout(waitForHashChange(), timeoutMs);
  } catch {
    // Hash change may have already fired synchronously.
  }

  try {
    await waitForLoadEvent(waitUntil, timeoutMs);
  } catch {
    // If the wait times out, return what we have.
  }

  return {
    url: window.location.href,
    title: document.title,
  };
}

// ── Handler ─────────────────────────────────────────────────────────────────

/**
 * Navigate the active browser tab to a URL.
 *
 * - Same-page (hash-only) navigation is handled fully in-page with
 *   DOM events (hashchange, load, DOMContentLoaded, networkidle).
 * - Cross-page navigation sets `window.location.href` and returns a
 *   sentinel so the service worker can pick up the post-navigation
 *   lifecycle.
 *
 * @param params — Raw navigate parameters (url, waitUntil?, timeout?).
 * @returns A {@link NavigateSuccessResult} for same-page navigation,
 *   a {@link NavigateCrossPage} sentinel for cross-page navigation,
 *   or a structured error on validation failure.
 */
export async function handleNavigate(
  params: unknown,
): Promise<NavigateResult> {
  const p = params as Record<string, unknown> | null | undefined;

  // ── Validate url parameter ────────────────────────────────────────────
  if (!p || typeof p.url !== "string") {
    return {
      code: "INVALID_URL",
      message: "Missing or invalid 'url' parameter.",
    };
  }

  const url = p.url;
  const waitUntil = (p.waitUntil as string | undefined) ?? "load";
  const timeoutMs = (p.timeout as number | undefined) ?? 30000;

  // ── Validate URL format ───────────────────────────────────────────────
  let targetUrl: URL;
  try {
    targetUrl = new URL(url);
  } catch {
    return {
      code: "INVALID_URL",
      message: `Invalid URL format: "${url}"`,
      suggestion:
        "Provide a fully-qualified URL like https://example.com",
    };
  }

  // ── Block restricted schemes ──────────────────────────────────────────
  if (isRestrictedUrl(targetUrl.href)) {
    return {
      code: "RESTRICTED_URL",
      message: `Navigation to "${targetUrl.protocol}//" URLs is blocked.`,
      suggestion: "Use https:// URLs for web pages.",
    };
  }

  // ── Detect same-page vs cross-page navigation ─────────────────────────
  const currentUrl = window.location.href;
  let currentParsed: URL;
  try {
    currentParsed = new URL(currentUrl);
  } catch {
    // Malformed current URL — proceed with cross-page navigation.
    window.location.href = targetUrl.href;
    return { status: "navigating", url: targetUrl.href };
  }

  const isSamePage =
    targetUrl.origin === currentParsed.origin &&
    targetUrl.pathname === currentParsed.pathname &&
    targetUrl.search === currentParsed.search;

  if (isSamePage) {
    // Same-page (hash-only) navigation — handle fully in-page.
    return handleSamePageNavigation(
      targetUrl.hash || "",
      waitUntil,
      timeoutMs,
    );
  }

  // ── Cross-page navigation ─────────────────────────────────────────────
  window.location.href = targetUrl.href;
  return { status: "navigating", url: targetUrl.href };
}
