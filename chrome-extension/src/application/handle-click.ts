/**
 * Click action handler — click an element in the active browser tab.
 *
 * Validates parameters, delegates to the domain-level clickHandler,
 * and returns a discriminated union so callers never encounter thrown errors.
 *
 * Pure application logic — zero Chrome API dependencies.
 *
 * @module application/handle-click
 */

import { clickHandler } from "../domain/index.js";
import type { ClickResult } from "./types.js";

/**
 * Click an element matching a CSS selector.
 *
 * Supports optional text-based disambiguation. Automatically waits
 * for the element to appear (polling up to `timeout` ms), scrolls it
 * into view, and detects navigation after the click.
 *
 * @param params — Raw click parameters (selector, text?, timeout?).
 * @returns A {@link ClickSuccessResult} on success, or a {@link ClickErrorResult}
 *   with a machine-readable error code and (for not-found errors) a list of
 *   matching element text suggestions.
 */
export async function handleClick(
  params: unknown,
): Promise<ClickResult> {
  return (await clickHandler(params)) as ClickResult;
}
