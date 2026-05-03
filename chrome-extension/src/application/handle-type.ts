/**
 * Type action handler — type text into an input element.
 *
 * Validates parameters, delegates to the domain-level typeHandler,
 * and returns a discriminated union so callers never encounter thrown errors.
 *
 * Pure application logic — zero Chrome API dependencies.
 *
 * @module application/handle-type
 */

import { typeHandler } from "../domain/index.js";
import type { TypeActionResult } from "./types.js";

/**
 * Type text into a DOM element identified by CSS selector.
 *
 * Locates the element, validates it is a typable, interactable element,
 * focuses it, sets the value (clearing first if requested), dispatches
 * framework-compatible events, and optionally submits the surrounding form.
 *
 * @param params — Raw type parameters (selector, text, clear?, submit?, timeout?).
 * @returns A {@link TypeSuccessResult} on success, or a {@link TypeErrorResultData}
 *   with a machine-readable error code, the element tag, and (for not-found
 *   errors) actionable suggestions listing typable elements on the page.
 */
export async function handleType(
  params: unknown,
): Promise<TypeActionResult> {
  return (await typeHandler(params)) as TypeActionResult;
}
