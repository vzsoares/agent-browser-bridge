/**
 * Wait-for-text action handler — wait for specific text to appear on the page.
 *
 * Validates parameters, delegates to the domain-level waitForText,
 * and returns timing metadata as a discriminated union.
 *
 * Pure application logic — zero Chrome API dependencies.
 *
 * @module application/handle-wait-for-text
 */

import { waitForText } from "../domain/index.js";
import type { WaitForTextActionResult } from "./types.js";

/** Parameters expected by the waitForText handler. */
interface WaitForTextParams {
  text: string;
  scope?: string;
  timeout?: number;
}

/**
 * Wait for specific case-sensitive text content to appear on the page.
 *
 * Optionally scoped to a CSS selector. The domain polls the page text
 * every 100ms until the text is found or the timeout expires.
 *
 * @param params — Raw wait parameters (text, scope?, timeout?).
 * @returns A {@link WaitForTextSuccess} with timing info on success,
 *   or a {@link WaitForTextError} with a TIMEOUT code on failure.
 */
export async function handleWaitForText(
  params: unknown,
): Promise<WaitForTextActionResult> {
  const p = params as WaitForTextParams | null | undefined;
  const text = p?.text;
  const scope =
    typeof p?.scope === "string" && p.scope.length > 0 ? p.scope : undefined;
  const timeout =
    typeof p?.timeout === "number" &&
    Number.isFinite(p.timeout) &&
    p.timeout > 0
      ? p.timeout
      : 10000;

  if (typeof text !== "string" || text.length === 0) {
    return {
      found: false,
      elapsedMs: 0,
      text: String(text ?? ""),
      error: "TIMEOUT",
      message: "Missing required parameter: text (non-empty string).",
    };
  }

  try {
    const result = await waitForText(text, scope, timeout);
    return {
      found: true,
      elapsedMs: result.elapsedMs,
      text,
    };
  } catch {
    const scopeLabel = scope ? ` within "${scope}"` : "";
    return {
      found: false,
      elapsedMs: timeout,
      text,
      error: "TIMEOUT",
      message: `Text "${text}" not found${scopeLabel} within ${timeout}ms.`,
    };
  }
}
