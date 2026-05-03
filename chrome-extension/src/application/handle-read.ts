/**
 * Read action handler — extract visible text from the browser tab.
 *
 * Validates parameters, delegates to the domain-level extractText,
 * and returns structured text content. Handles invalid CSS selectors
 * and missing elements with descriptive errors.
 *
 * Pure application logic — zero Chrome API dependencies.
 *
 * @module application/handle-read
 */

import { extractText } from "../domain/index.js";
import type { ReadSuccess } from "./types.js";
import type { ErrorResponse } from "@pi-browser-bridge/protocol";

/**
 * Read the visible text content of the active browser tab.
 *
 * Optionally scoped to a CSS selector. Long pages are truncated
 * to `maxLength` characters with a truncation flag.
 *
 * @param params — Raw read parameters (selector?, maxLength?).
 * @param params.selector — Optional CSS selector to scope the read.
 * @param params.maxLength — Max characters before truncation (default 50 000).
 * @param doc — Document reference (defaults to globalThis.document).
 *   Allows dependency injection for testing.
 * @returns The extracted text on success, or a structured error on failure.
 */
export async function handleRead(
  params: unknown,
  doc: Document = document,
): Promise<ReadSuccess | ErrorResponse> {
  const p = params as Record<string, unknown> | null | undefined;
  const selector = typeof p?.selector === "string" ? p.selector : undefined;
  const maxLength =
    typeof p?.maxLength === "number" &&
    Number.isFinite(p.maxLength) &&
    p.maxLength > 0
      ? Math.floor(p.maxLength)
      : 50_000;

  let root: Element | null;
  if (selector) {
    try {
      root = doc.querySelector(selector);
    } catch {
      return {
        code: "ELEMENT_NOT_FOUND",
        message: `Invalid CSS selector: "${selector}"`,
        suggestion:
          "Check the selector syntax. Use valid CSS selectors like '#id', '.class', or 'tag'.",
      };
    }

    if (!root) {
      return {
        code: "ELEMENT_NOT_FOUND",
        message: `No element matching selector "${selector}" found on the page.`,
        suggestion:
          "Try a different selector. Common issues: the element might be inside a shadow DOM, an iframe, or loaded dynamically after page load.",
      };
    }
  } else {
    root = doc.body;
    if (!root) {
      return { text: "", length: 0, truncated: false };
    }
  }

  return extractText(root, maxLength);
}
