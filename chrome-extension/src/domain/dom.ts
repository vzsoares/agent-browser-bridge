/**
 * Pure DOM helpers — zero Chrome API dependencies.
 *
 * Every function in this module operates on standard DOM APIs
 * (document, window, Element, etc.) and is fully testable with
 * happy-dom / jsdom.
 *
 * @module domain/dom
 */

import { BLOCK_TAGS, POLL_INTERVAL_MS, SKIP_TAGS } from "./constants.js";

// ────────────────────────────────────────────────────────────────────────────
// waitForElement
// ────────────────────────────────────────────────────────────────────────────

/** Result when waitForElement succeeds. */
export interface WaitForElementResult {
	found: true;
	elapsedMs: number;
	element: Element;
}

/**
 * Wait for an element matching `selector` to appear in the DOM.
 *
 * Uses a MutationObserver for efficiency (resolves as soon as the
 * element is added) with a 100ms polling fallback as a safety net.
 *
 * @param selector CSS selector string.
 * @param timeout  Maximum wait time in milliseconds.
 * @returns The element with timing metadata.
 * @throws {Error} with message `"TIMEOUT"` when the element doesn't
 *   appear within the timeout.
 */
export function waitForElement(
	selector: string,
	timeout: number,
): Promise<WaitForElementResult> {
	return new Promise((resolve, reject) => {
		// Check immediately in case the element is already in the DOM.
		const existing = document.querySelector(selector);
		if (existing) {
			resolve({ found: true, elapsedMs: 0, element: existing });
			return;
		}

		const started = Date.now();

		// ── MutationObserver (efficient path) ──────────────────────────
		let observer: MutationObserver | null = null;
		try {
			observer = new MutationObserver(() => {
				const el = document.querySelector(selector);
				if (el) {
					observer?.disconnect();
					resolve({
						found: true,
						elapsedMs: Date.now() - started,
						element: el,
					});
				}
			});
			observer.observe(document.documentElement, {
				childList: true,
				subtree: true,
				// Observe attribute changes too in case the selector relies
				// on a class or attribute being added dynamically.
				attributes: true,
			});
		} catch {
			// MutationObserver may not be available (e.g. restricted
			// environment). Fall through to polling below.
		}

		// ── Polling fallback / safety net ──────────────────────────────
		const interval = setInterval(() => {
			const el = document.querySelector(selector);
			if (el) {
				clearInterval(interval);
				observer?.disconnect();
				resolve({
					found: true,
					elapsedMs: Date.now() - started,
					element: el,
				});
				return;
			}
			if (Date.now() - started >= timeout) {
				clearInterval(interval);
				observer?.disconnect();
				reject(new Error("TIMEOUT"));
			}
		}, POLL_INTERVAL_MS);
	});
}

// ────────────────────────────────────────────────────────────────────────────
// waitForText
// ────────────────────────────────────────────────────────────────────────────

/** Result when waitForText succeeds. */
export interface WaitForTextResult {
	found: true;
	elapsedMs: number;
}

/**
 * Poll for text content inside the page (or an optional scope) until the
 * given string is found or the timeout expires.
 *
 * Uses `textContent` for reliability — works on any `Element`, doesn't
 * trigger layout recalculation, and matches both visible and
 * dynamically-inserted text nodes.
 *
 * @param text    Case-sensitive substring to search for.
 * @param scope   Optional CSS selector to limit the search area.
 *                When omitted the entire `<body>` is searched.
 * @param timeout Maximum time to wait in milliseconds (default 10 000).
 * @throws {Error} with message `"TIMEOUT"` when the text doesn't appear
 *   within the timeout.
 */
export function waitForText(
	text: string,
	scope?: string,
	timeout = 10000,
): Promise<WaitForTextResult> {
	return new Promise((resolve, reject) => {
		const started = Date.now();

		const check = (): boolean => {
			const root = scope ? document.querySelector(scope) : document.body;
			if (!root) return false;
			return (root.textContent ?? "").includes(text);
		};

		// Check immediately.
		if (check()) {
			resolve({ found: true, elapsedMs: 0 });
			return;
		}

		const interval = setInterval(() => {
			if (check()) {
				clearInterval(interval);
				resolve({ found: true, elapsedMs: Date.now() - started });
				return;
			}
			if (Date.now() - started >= timeout) {
				clearInterval(interval);
				reject(new Error("TIMEOUT"));
			}
		}, POLL_INTERVAL_MS);
	});
}

// ────────────────────────────────────────────────────────────────────────────
// isInteractable / isHidden / isClickable
// ────────────────────────────────────────────────────────────────────────────

/**
 * Check whether an element is interactable — not disabled, not hidden via
 * display:none or visibility:hidden, and not marked read-only.
 */
export function isInteractable(el: HTMLElement): boolean {
	// Check for the HTML `disabled` attribute (applies to input, textarea,
	// button, select, etc.).
	if ((el as HTMLInputElement).disabled) return false;

	// Check for `readonly` (only meaningful on input/textarea, but safe).
	if ((el as HTMLInputElement).readOnly) return false;

	// Check visibility — computed display: none means the element isn't
	// rendered, and visibility: hidden means it's not interactable.
	const style = getComputedStyle(el);
	if (style.display === "none" || style.visibility === "hidden") {
		return false;
	}

	// Check for `aria-hidden`
	if (el.getAttribute("aria-hidden") === "true") return false;

	// Check if the element (or an ancestor) is actually hidden via the
	// `hidden` attribute.
	if (el.closest("[hidden]")) return false;

	return true;
}

/**
 * Check whether an element is hidden from the user (for text extraction).
 */
export function isHidden(el: Element): boolean {
	const style = getComputedStyle(el);
	return (
		style.display === "none" ||
		style.visibility === "hidden" ||
		style.opacity === "0"
	);
}

/**
 * Check whether an element is visible and enabled (click-specific).
 *
 * More permissive than `isInteractable` — does not check `aria-hidden`
 * or `[hidden]` ancestor since click targets are entirely about
 * layout-driven visibility.  Checking `getBoundingClientRect` catches
 * display:none, visibility:hidden, and zero-size elements.
 */
export function isClickable(el: Element): boolean {
	const htmlEl = el as HTMLElement;

	const style = getComputedStyle(htmlEl);
	if (style.display === "none" || style.visibility === "hidden") {
		return false;
	}

	// Check element has layout (zero-size elements are effectively invisible)
	const rect = htmlEl.getBoundingClientRect();
	if (rect.width === 0 && rect.height === 0) {
		return false;
	}

	// Check disabled state (form controls, buttons, etc.)
	if ("disabled" in htmlEl && (htmlEl as HTMLButtonElement).disabled === true) {
		return false;
	}

	// Check aria-disabled
	if (htmlEl.getAttribute("aria-disabled") === "true") {
		return false;
	}

	return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Click target helpers
// ────────────────────────────────────────────────────────────────────────────

/** Sleep helper. */
export function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/** Query the DOM for a click target matching selector and optional text filter. */
export function findClickTarget(
	selector: string,
	textFilter: string | null,
): Element | null {
	if (!textFilter) {
		return document.querySelector(selector);
	}

	const all = document.querySelectorAll(selector);
	for (const el of all) {
		const content = (el.textContent ?? "").trim().toLowerCase();
		if (content.includes(textFilter)) {
			return el;
		}
	}
	return null;
}

/** Poll until a click target matching `selector` (and optionally `textFilter`) appears, or timeout. */
export async function waitForClickTarget(
	selector: string,
	textFilter: string | null,
	timeout: number,
): Promise<Element | null> {
	const started = Date.now();
	const pollInterval = 50;

	while (Date.now() - started < timeout) {
		const el = findClickTarget(selector, textFilter);
		if (el) return el;
		await sleep(pollInterval);
	}

	// One final attempt right at timeout
	return findClickTarget(selector, textFilter);
}

// ────────────────────────────────────────────────────────────────────────────
// Input interaction helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Use the native property setter so framework-managed inputs (React in
 * particular) register the change. Setting `.value` directly bypasses
 * React's synthetic property descriptor; calling the native setter
 * triggers React's change tracking.
 */
export function setNativeValue(
	el: HTMLInputElement | HTMLTextAreaElement,
	value: string,
): void {
	const descriptor = Object.getOwnPropertyDescriptor(
		el.tagName === "INPUT"
			? window.HTMLInputElement.prototype
			: window.HTMLTextAreaElement.prototype,
		"value",
	);
	const setter = descriptor?.set;
	if (setter) {
		setter.call(el, value);
	} else {
		el.value = value;
	}
}

/**
 * Dispatch bubbling events on an element so framework-controlled listeners
 * (React onChange, Vue v-model, Svelte bind:value) fire.
 */
export function dispatchInputEvents(el: HTMLElement): void {
	el.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
	el.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
}

/**
 * Attempt form submission. Prefer `form.requestSubmit()` (triggers
 * validation and submit events naturally). Fall back to dispatching an
 * Enter keydown on the element itself.
 */
export function triggerSubmit(el: HTMLElement): void {
	const form = el.closest("form");
	if (form) {
		try {
			form.requestSubmit();
			return;
		} catch {
			// `requestSubmit()` throws if the form is not submittable
			// (e.g. missing action, validation fails). Fall through to
			// the keyboard fallback.
		}
	}

	// Fallback — dispatch an Enter keystroke on the element.
	const enterEvent = new KeyboardEvent("keydown", {
		key: "Enter",
		code: "Enter",
		keyCode: 13,
		which: 13,
		bubbles: true,
		cancelable: true,
		composed: true,
	});
	el.dispatchEvent(enterEvent);
}

// ────────────────────────────────────────────────────────────────────────────
// Text extraction
// ────────────────────────────────────────────────────────────────────────────

/** Safely collapse whitespace into a single space for inline text runs. */
export function collapse(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Build a human-friendly representation of an <a> element's href. */
export function linkAnnotation(el: HTMLAnchorElement): string {
	const href = el.getAttribute("href") ?? "";
	if (!href || href.startsWith("#")) return "";
	const display = href.length > 80 ? `${href.slice(0, 77)}…` : href;
	return ` [${display}]`;
}

/** Best-effort label inference for form controls. */
export function inferLabel(el: Element): string {
	const ariaLabel = el.getAttribute("aria-label");
	if (ariaLabel && collapse(ariaLabel)) return ariaLabel;

	const id = el.getAttribute("id");
	if (id) {
		const labelEl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
		if (labelEl) {
			const text = collapse(labelEl.textContent ?? "");
			if (text) return text;
		}
	}

	const parentLabel = el.closest("label");
	if (parentLabel) {
		const clone = parentLabel.cloneNode(true) as HTMLElement;
		const inputs = clone.querySelectorAll("input, select, textarea, button");
		for (const input of inputs) input.remove();
		const text = collapse(clone.textContent ?? "");
		if (text) return text;
	}

	const placeholder = (el as HTMLInputElement).getAttribute("placeholder");
	if (placeholder) return placeholder;

	const name = el.getAttribute("name");
	if (name) return name;

	return "";
}

// ────────────────────────────────────────────────────────────────────────────
// Core DOM text extractor
// ────────────────────────────────────────────────────────────────────────────

/** Text extraction result. */
export interface ExtractTextResult {
	text: string;
	length: number;
	truncated: boolean;
}

interface WalkState {
	parts: string[];
	totalChars: number;
	maxChars: number;
	truncated: boolean;
}

function walkElement(el: Element, state: WalkState, indent: number): boolean {
	if (state.totalChars >= state.maxChars) {
		state.truncated = true;
		return false;
	}

	const tag = el.tagName.toLowerCase();

	if (SKIP_TAGS.has(tag)) return true;

	if (tag !== "body" && tag !== "html" && isHidden(el)) {
		return true;
	}

	const ariaLabel = el.getAttribute("aria-label");
	const hasAriaLabel = ariaLabel && collapse(ariaLabel);

	// <img>
	if (tag === "img") {
		const alt = (el as HTMLImageElement).alt?.trim();
		if (alt) {
			const line = `Image: "${alt}"`;
			state.totalChars += line.length + 1;
			state.parts.push(line);
		}
		return true;
	}

	// <input>
	if (tag === "input") {
		const inputEl = el as HTMLInputElement;
		const inputType = inputEl.type?.toLowerCase();
		if (inputType === "hidden") return true;

		const label = inferLabel(el);
		const placeholder = inputEl.getAttribute("placeholder")?.trim();
		const value = inputEl.value?.trim();

		if (
			inputType === "submit" ||
			inputType === "button" ||
			inputType === "reset"
		) {
			const buttonLabel = value || label || placeholder || `[${inputType}]`;
			const line = `[Button: ${buttonLabel}]`;
			state.totalChars += line.length + 1;
			state.parts.push(line);
			return true;
		}
		if (inputType === "checkbox" || inputType === "radio") {
			const checked = inputEl.checked ? "checked" : "unchecked";
			const checkboxLabel = label || value || placeholder || `[${inputType}]`;
			const line = `[${checked}] ${checkboxLabel}`;
			state.totalChars += line.length + 1;
			state.parts.push(line);
			return true;
		}

		const fragments: string[] = [];
		if (label) fragments.push(`"${label}"`);
		if (placeholder) fragments.push(`placeholder="${placeholder}"`);
		if (value) fragments.push(`value="${value}"`);
		if (fragments.length > 0) {
			const line = `Input: ${fragments.join(", ")}`;
			state.totalChars += line.length + 1;
			state.parts.push(line);
		}
		return true;
	}

	// <textarea>
	if (tag === "textarea") {
		const label = inferLabel(el);
		const value = (el as HTMLTextAreaElement).value?.trim();
		const placeholder = el.getAttribute("placeholder")?.trim();
		const fragments: string[] = [];
		if (label) fragments.push(`"${label}"`);
		if (placeholder) fragments.push(`placeholder="${placeholder}"`);
		if (value) fragments.push(`value="${value}"`);
		if (fragments.length > 0) {
			const line = `Textarea: ${fragments.join(", ")}`;
			state.totalChars += line.length + 1;
			state.parts.push(line);
		}
		return true;
	}

	// <select>
	if (tag === "select") {
		const label = inferLabel(el);
		const sel = el as HTMLSelectElement;
		const selectedOption = sel.options[sel.selectedIndex]?.textContent?.trim();
		const fragments: string[] = [];
		if (label) fragments.push(`"${label}"`);
		if (selectedOption) fragments.push(`selected="${selectedOption}"`);
		if (fragments.length > 0) {
			const line = `Select: ${fragments.join(", ")}`;
			state.totalChars += line.length + 1;
			state.parts.push(line);
		}
		return true;
	}

	// <button>
	if (tag === "button") {
		const buttonText = collapse(el.textContent ?? "");
		if (buttonText) {
			const line = `[Button: ${buttonText}]`;
			state.totalChars += line.length + 1;
			state.parts.push(line);
		}
		return true;
	}

	// <br>
	if (tag === "br") {
		state.parts.push("");
		state.totalChars += 1;
		return true;
	}

	// <hr>
	if (tag === "hr") {
		state.parts.push("---");
		state.totalChars += 4;
		return true;
	}

	// Pre-element markers
	let preMarker = "";
	let postMarker = "";
	const isHeading = /^h[1-6]$/.test(tag);
	const isParagraph = tag === "p";
	const isListItem = tag === "li";
	const isLink = tag === "a";
	const isListContainer = tag === "ul" || tag === "ol" || tag === "dl";

	if (
		hasAriaLabel &&
		!isLink &&
		!isHeading &&
		!isParagraph &&
		!isListItem &&
		!isListContainer
	) {
		state.parts.push(`[${ariaLabel}]`);
		state.totalChars += ariaLabel?.length + 3;
	}

	if (isHeading) {
		preMarker = "\n";
		postMarker = "\n";
	} else if (isParagraph) {
		preMarker = "\n";
		postMarker = "\n";
	} else if (isListItem) {
		preMarker = `\n${"  ".repeat(indent)}* `;
	}

	if (preMarker) {
		state.totalChars += preMarker.length;
		state.parts.push(preMarker);
	}

	const childIndent = isListItem ? indent + 1 : indent;
	for (const child of el.childNodes) {
		if (!walkNode(child, state, childIndent)) return false;
	}

	if (isLink) {
		const annotation = linkAnnotation(el as HTMLAnchorElement);
		if (annotation) {
			state.totalChars += annotation.length;
			state.parts.push(annotation);
		}
		let hasBlockChild = false;
		for (const child of el.children) {
			if (BLOCK_TAGS.has(child.tagName.toLowerCase())) {
				hasBlockChild = true;
				break;
			}
		}
		if (hasBlockChild) {
			state.totalChars += 1;
			state.parts.push("\n");
		}
	}

	if (postMarker) {
		state.totalChars += postMarker.length;
		state.parts.push(postMarker);
	}

	if (BLOCK_TAGS.has(tag) && !isListItem && !isHeading && !isParagraph) {
		state.totalChars += 1;
		state.parts.push("\n");
	}

	return true;
}

function walkNode(node: Node, state: WalkState, indent: number): boolean {
	if (state.totalChars >= state.maxChars) {
		state.truncated = true;
		return false;
	}

	if (node.nodeType === Node.TEXT_NODE) {
		const raw = node.textContent ?? "";
		const trimmed = raw.replace(/\s+/g, " ");
		const text = trimmed.length > 0 && trimmed !== " " ? trimmed : "";
		if (text) {
			const last = state.parts[state.parts.length - 1];
			const needsSpace = last && last.length > 0 && !/\s$/.test(last);
			const prefix = needsSpace ? " " : "";
			state.totalChars += prefix.length + text.length;
			state.parts.push(prefix + text);
		}
		return true;
	}

	if (node.nodeType === Node.ELEMENT_NODE) {
		return walkElement(node as Element, state, indent);
	}

	return true;
}

/**
 * Extract human-readable text from a DOM element subtree.
 *
 * Special elements (inputs, buttons, selects, images, links) are
 * rendered with semantic annotations. Script/style/noscript and
 * visually-hidden elements are skipped.
 *
 * @param root      Root element to walk.
 * @param maxLength Maximum characters before truncation.
 * @returns The extracted text, its approximate length, and a
 *          `truncated` flag.
 */
export function extractText(
	root: Element,
	maxLength: number,
): ExtractTextResult {
	const state: WalkState = {
		parts: [],
		totalChars: 0,
		maxChars: maxLength,
		truncated: false,
	};

	for (const child of root.childNodes) {
		if (!walkNode(child, state, 0)) break;
	}

	let text = state.parts.join("");
	text = text.replace(/\n{3,}/g, "\n\n");
	text = text.replace(/^\s*\n/, "").replace(/\n\s*$/, "");

	return { text, length: state.totalChars, truncated: state.truncated };
}

// ────────────────────────────────────────────────────────────────────────────
// General utilities
// ────────────────────────────────────────────────────────────────────────────

/**
 * Wrap a promise with a timeout. Rejects with an Error if the timeout is
 * reached before the promise settles.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_, reject) =>
			setTimeout(
				() => reject(new Error(`Operation timed out after ${ms}ms`)),
				ms,
			),
		),
	]);
}

/**
 * Collect all visible typable elements on the page as string suggestions
 * (useful for error messages to guide the LLM).
 */
export function collectTypableSuggestions(): string[] {
	const allTypable = document.querySelectorAll(
		'input:not([type="hidden"]), textarea, [contenteditable="true"]',
	);
	return Array.from(allTypable)
		.map((el) => {
			const tag = el.tagName.toLowerCase();
			const id = el.id ? `#${el.id}` : "";
			const cls =
				el.className && typeof el.className === "string"
					? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}`
					: "";
			const name = el.getAttribute("name")
				? `[name="${el.getAttribute("name")}"]`
				: "";
			const placeholder = el.getAttribute("placeholder")
				? ` (placeholder: "${el.getAttribute("placeholder")?.slice(0, 30)}")`
				: "";
			return `<${tag}${id}${cls}${name}>${placeholder}`;
		})
		.slice(0, 10);
}
