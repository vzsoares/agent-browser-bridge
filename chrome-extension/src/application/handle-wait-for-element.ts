/**
 * Wait-for-element action handler — wait for an element to appear in the DOM.
 *
 * Validates parameters, delegates to the domain-level waitForElement,
 * and returns timing metadata as a discriminated union.
 *
 * Pure application logic — zero Chrome API dependencies.
 *
 * @module application/handle-wait-for-element
 */

import { waitForElement } from "../domain/index.js";
import type { WaitForElementActionResult } from "./types.js";

/** Parameters expected by the waitForElement handler. */
interface WaitForElementParams {
  selector: string;
  timeout?: number;
}

/**
 * Wait for an element matching a CSS selector to appear in the DOM.
 *
 * Uses MutationObserver for efficiency (resolves as soon as the element
 * is added) with a 100ms polling fallback as a safety net.
 *
 * @param params — Raw wait parameters (selector, timeout?).
 * @returns A {@link WaitForElementSuccess} with timing info on success,
 *   or a {@link WaitForElementError} with a TIMEOUT code on failure.
 */
export async function handleWaitForElement(
  params: unknown,
): Promise<WaitForElementActionResult> {
  const p = params as WaitForElementParams | null | undefined;
  const selector = p?.selector;
  const timeout =
    typeof p?.timeout === "number" &&
    Number.isFinite(p.timeout) &&
    p.timeout > 0
      ? p.timeout
      : 10000;

  if (typeof selector !== "string" || selector.length === 0) {
    return {
      found: false,
      elapsedMs: 0,
      selector: String(selector ?? ""),
      error: "ELEMENT_NOT_FOUND",
      message: "Missing required parameter: selector (non-empty string).",
    };
  }

  try {
    const result = await waitForElement(selector, timeout);
    return {
      found: true,
      elapsedMs: result.elapsedMs,
      selector,
      tagName: result.element.tagName.toLowerCase(),
    };
  } catch {
    return {
      found: false,
      elapsedMs: timeout,
      selector,
      error: "TIMEOUT",
      message: `Element "${selector}" not found within ${timeout}ms.`,
    };
  }
}
