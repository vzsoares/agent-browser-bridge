/**
 * Domain-level element interaction logic — click and type handlers.
 *
 * Pure DOM manipulation. Zero Chrome API dependencies.
 * Fully testable with happy-dom.
 *
 * @module domain/interactions
 */

import type { TypeParams } from "@agent-browser-bridge/protocol";
import { TYPABLE_ELEMENTS } from "./constants.js";
import {
	collectTypableSuggestions,
	dispatchInputEvents,
	isClickable,
	isInteractable,
	setNativeValue,
	sleep,
	triggerSubmit,
	waitForClickTarget,
	waitForElement,
} from "./dom.js";

// ────────────────────────────────────────────────────────────────────────────
// clickHandler
// ────────────────────────────────────────────────────────────────────────────

/** Parameters expected by the click handler. */
export interface ClickHandlerParams {
	selector: string;
	text?: string;
	timeout?: number;
}

/** Successful click result. */
export interface ClickSuccess {
	clicked: true;
	selector: string;
	text: string;
	navigated: boolean;
	newTitle?: string;
	newUrl?: string;
}

/** Failed click result with possible suggestions. */
export interface ClickError {
	clicked: false;
	code: string;
	message: string;
	suggestions?: string[];
}

/** Union of possible click outcomes. */
export type ClickResult = ClickSuccess | ClickError;

/**
 * Click an element identified by CSS selector, with optional text-based
 * disambiguation.
 *
 * Phases:
 *  1. Validate parameters.
 *  2. Wait for the element to appear (polling up to `timeout` ms).
 *  3. If a text filter is provided, find the match whose textContent
 *     includes the filter string (case-insensitive, trimmed).
 *  4. Validate the element is visible and enabled.
 *  5. Scroll it into view, click it, then detect navigation.
 *
 * @param params                Click parameters.
 * @param params.selector       CSS selector of the element to click.
 * @param params.text           Optional text filter for disambiguation.
 * @param params.timeout        Max wait time in ms (default 10 000).
 * @param _doc                  Document reference (defaults to globalThis.document).
 *                              Allows dependency injection for testing.
 * @returns A {@link ClickSuccess} or {@link ClickError}.
 */
export async function clickHandler(
	params: ClickHandlerParams | unknown,
	_doc: Document = document,
): Promise<ClickResult> {
	// ── Validate parameters ────────────────────────────────────────────
	if (typeof params !== "object" || params === null) {
		return {
			clicked: false,
			code: "ELEMENT_NOT_FOUND",
			message:
				"Invalid parameters: expected an object with selector, text?, timeout?.",
		};
	}

	const p = params as ClickHandlerParams;

	if (typeof p.selector !== "string" || p.selector.length === 0) {
		return {
			clicked: false,
			code: "ELEMENT_NOT_FOUND",
			message: "Missing required parameter: selector (non-empty string).",
		};
	}

	const selector = p.selector;
	const textFilter =
		typeof p.text === "string" && p.text.length > 0
			? p.text.trim().toLowerCase()
			: null;
	const timeout =
		typeof p.timeout === "number" && Number.isFinite(p.timeout) && p.timeout > 0
			? p.timeout
			: 10000;

	// ── Phase 1: wait for element ───────────────────────────────────────
	const element = await waitForClickTarget(selector, textFilter, timeout);

	if (!element) {
		// Collect text contents of all matching-selector elements as suggestions
		const allMatches = _doc.querySelectorAll(selector);
		const suggestions = Array.from(allMatches)
			.map((el) => el.textContent?.trim() ?? "")
			.filter((s) => s.length > 0);

		return {
			clicked: false,
			code: "ELEMENT_NOT_FOUND",
			message: textFilter
				? `No element matching "${selector}" with text containing "${p.text}" was found.`
				: `No element matching "${selector}" was found.`,
			suggestions: suggestions.length > 0 ? suggestions : undefined,
		};
	}

	// ── Phase 2: validate interactability ────────────────────────────────
	if (!isClickable(element)) {
		return {
			clicked: false,
			code: "ELEMENT_NOT_INTERACTABLE",
			message: `Element matching "${selector}" is hidden or disabled and cannot be clicked.`,
		};
	}

	// ── Phase 3: scroll into view ────────────────────────────────────────
	element.scrollIntoView({ behavior: "smooth", block: "center" });
	// Give the smooth scroll a moment to start before clicking
	await sleep(100);

	// ── Phase 4: click ───────────────────────────────────────────────────
	const previousUrl = _doc.defaultView?.location.href ?? "";

	(element as HTMLElement).click();

	// Wait then check whether navigation occurred
	await sleep(300);

	const currentUrl = _doc.defaultView?.location.href ?? "";
	const navigated = currentUrl !== previousUrl;
	const elementText = element.textContent?.trim() ?? "";

	const result: ClickSuccess = {
		clicked: true,
		selector,
		text: elementText,
		navigated,
	};

	if (navigated) {
		result.newTitle = _doc.title;
		result.newUrl = currentUrl;
	}

	return result;
}

// ────────────────────────────────────────────────────────────────────────────
// typeHandler
// ────────────────────────────────────────────────────────────────────────────

/** Shape returned by the type handler on success. */
export interface TypeSuccess {
	typed: true;
	selector: string;
	value: string;
}

/** Shape returned by the type handler on failure. */
export interface TypeErrorResult {
	typed: false;
	selector: string;
	error: string;
	message: string;
	tag?: string;
	/** Actionable hint for the LLM (e.g. list of matching typable elements). */
	suggestions?: string;
}

/** Union of possible type outcomes. */
export type TypeResult = TypeSuccess | TypeErrorResult;

/**
 * Type text into a DOM element identified by CSS selector.
 *
 * Locates an element by CSS selector, validates it is a typable,
 * interactable element, focuses it, sets the value (clearing first if
 * requested), dispatches framework-compatible events, and optionally
 * submits the surrounding form.
 *
 * @param params        Type parameters.
 * @param params.selector  CSS selector of the input element.
 * @param params.text      Text to type into the element.
 * @param params.clear     Clear existing value before typing (default true).
 * @param params.submit    Press Enter after typing (default false).
 * @param params.timeout   Max wait time in ms (default 10 000).
 * @param _doc             Document reference (defaults to globalThis.document).
 * @returns A {@link TypeSuccess} or {@link TypeErrorResult}.
 */
export async function typeHandler(
	params: TypeParams | unknown,
	_doc: Document = document,
): Promise<TypeResult> {
	const p = params as TypeParams;
	if (!p || typeof p.selector !== "string" || typeof p.text !== "string") {
		return {
			typed: false,
			selector: typeof p?.selector === "string" ? p.selector : "",
			error: "ELEMENT_NOT_FOUND",
			message:
				"Missing required parameters: selector (string) and text (string).",
		};
	}

	const { selector, text } = p;
	const clear = p.clear ?? true;
	const submit = p.submit ?? false;
	const timeout = p.timeout ?? 10000;

	// ── Locate element (with timeout) ───────────────────────────────────
	let el: Element;
	try {
		const result = await waitForElement(selector, timeout);
		el = result.element;
	} catch {
		const suggestions = collectTypableSuggestions();

		return {
			typed: false,
			selector,
			error: "ELEMENT_NOT_FOUND",
			message: `Element "${selector}" not found within ${timeout}ms.`,
			suggestions:
				suggestions.length > 0
					? `Typable elements on the page: ${suggestions.join(", ")}`
					: undefined,
		};
	}

	const tag = el.tagName.toUpperCase();

	// ── Validate element is typable ─────────────────────────────────────
	const isInputOrTextarea = TYPABLE_ELEMENTS.has(tag);
	const isContentEditable =
		(el as HTMLElement).isContentEditable ||
		el.getAttribute("contenteditable") === "true";

	if (!isInputOrTextarea && !isContentEditable) {
		return {
			typed: false,
			selector,
			error: "ELEMENT_NOT_TYPABLE",
			message: `Element "${selector}" (<${tag.toLowerCase()}>) is not a typable element. Expected <input>, <textarea>, or [contenteditable="true"].`,
			tag: tag.toLowerCase(),
		};
	}

	// ── Validate element is interactable ────────────────────────────────
	if (!isInteractable(el as HTMLElement)) {
		return {
			typed: false,
			selector,
			error: "ELEMENT_NOT_INTERACTABLE",
			message: `Element "${selector}" is disabled, hidden, or read-only.`,
			tag: tag.toLowerCase(),
		};
	}

	const htmlEl = el as HTMLElement;

	// ── Focus ───────────────────────────────────────────────────────────
	htmlEl.focus();

	// ── Branch on element type ──────────────────────────────────────────
	if (isContentEditable) {
		// ── contenteditable path ──────────────────────────────────────
		if (clear) {
			htmlEl.textContent = "";
		}
		htmlEl.textContent = text;
		// contenteditable needs the "input" event for frameworks to
		// pick up the change.
		htmlEl.dispatchEvent(
			new Event("input", { bubbles: true, cancelable: true }),
		);
	} else {
		// ── <input> / <textarea> path ─────────────────────────────────
		const inputEl = el as HTMLInputElement | HTMLTextAreaElement;

		if (clear) {
			setNativeValue(inputEl, "");
			// Fire input so frameworks register the clear.
			el.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
		}

		setNativeValue(inputEl, text);
		dispatchInputEvents(el as HTMLElement);
	}

	// ── Optional form submission ────────────────────────────────────────
	if (submit) {
		triggerSubmit(htmlEl);
	}

	// ── Read back final value ───────────────────────────────────────────
	const finalValue = isContentEditable
		? (htmlEl.textContent ?? "")
		: (el as HTMLInputElement | HTMLTextAreaElement).value;

	return {
		typed: true,
		selector,
		value: finalValue,
	};
}
