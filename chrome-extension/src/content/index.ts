import type { ErrorCode, ExecResult, Response, TypeParams } from "@pi-browser-bridge/protocol";

console.log("[pi-browser-bridge] Content script injected");

// ── Domain allowlist (defence-in-depth) ─────────────────────────────────

const ALLOWLIST_STORAGE_KEY = "domainAllowlist";

/**
 * Convert a glob-style domain pattern to a case-insensitive RegExp.
 * Matches the same logic as the service worker's `globToRegex`.
 */
function globToRegex(pattern: string): RegExp {
  let regex = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern.charAt(i);
    if (ch === "*") {
      regex += "[^.]+";
    } else if (ch === "?") {
      regex += "[^.]";
    } else if (".^$+={}[]|\\()".includes(ch)) {
      regex += "\\" + ch;
    } else {
      regex += ch;
    }
  }
  return new RegExp(`^${regex}$`, "i");
}

/** Test a hostname against a set of glob patterns. */
function matchDomain(hostname: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    const trimmed = pattern.trim();
    if (trimmed === "") continue;
    if (trimmed === "*") return true;
    if (trimmed.startsWith("#")) continue;
    if (globToRegex(trimmed).test(hostname)) return true;
  }
  return false;
}

/**
 * Defence-in-depth domain check. Reads the allowlist from storage and
 * tests `window.location.hostname` against it. Returns `true` when the
 * page is allowed or the check cannot be performed (fail-open for
 * availability).
 */
async function checkDomainAllowed(): Promise<boolean> {
  try {
    const stored = (await chrome.storage.local.get(ALLOWLIST_STORAGE_KEY)) as Record<string, unknown>;
    const raw = stored[ALLOWLIST_STORAGE_KEY];
    const allowlist: string[] =
      Array.isArray(raw) && raw.length > 0 && raw.every((v): v is string => typeof v === "string")
        ? raw
        : ["*"];
    const hostname = window.location.hostname;
    if (!hostname) return true; // about:blank, etc. — allow
    return matchDomain(hostname, allowlist);
  } catch {
    // If storage is unavailable, fail open.
    return true;
  }
}

// ── Types ───────────────────────────────────────────────────────────────

/** Signature for every DOM-operation handler. */
type ActionHandler = (params: unknown) => Promise<unknown>;

/** Parameters expected by the click handler. */
interface ClickHandlerParams {
  selector: string;
  text?: string;
  timeout?: number;
}

/** Successful click result. */
interface ClickSuccess {
  clicked: true;
  selector: string;
  text: string;
  navigated: boolean;
  newTitle?: string;
  newUrl?: string;
}

/** Failed click result with possible suggestions. */
interface ClickError {
  clicked: false;
  code: string;
  message: string;
  suggestions?: string[];
}

/** Shape returned by the type handler on success. */
interface TypeSuccess {
  typed: true;
  selector: string;
  value: string;
}

/** Shape returned by the type handler on failure. */
interface TypeError {
  typed: false;
  selector: string;
  error: ErrorCode;
  message: string;
  tag?: string;
  /** Actionable hint for the LLM (e.g. list of matching typable elements). */
  suggestions?: string;
}

// ── Type handler helpers ────────────────────────────────────────────────

/** Set of element tag names that accept typed input. */
const TYPABLE_ELEMENTS = new Set(["INPUT", "TEXTAREA"]);

/**
 * Wait for an element matching `selector` to appear in the DOM.
 *
 * Uses a MutationObserver for efficiency (resolves as soon as the
 * element is added) with a 100ms polling fallback as a safety net.
 *
 * @returns The element with timing metadata.
 * @throws {Error} with message `"TIMEOUT"` when the element doesn't
 *   appear within the timeout.
 */
function waitForElement(
  selector: string,
  timeout: number,
): Promise<{ found: true; elapsedMs: number; element: Element }> {
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
          observer!.disconnect();
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
        // Observe attribute changes too in case the selector
        // relies on a class or attribute being added dynamically.
        attributes: true,
      });
    } catch {
      // MutationObserver may not be available (e.g. restricted
      // environment). Fall through to polling below.
    }

    // ── Polling fallback / safety net ──────────────────────────────
    const POLL_INTERVAL_MS = 100;
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
function waitForText(
  text: string,
  scope?: string,
  timeout = 10000,
): Promise<{ found: true; elapsedMs: number }> {
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

    const POLL_INTERVAL_MS = 100;
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

/**
 * Check whether an element is interactable — not disabled, not hidden via
 * display:none or visibility:hidden, and not marked read-only.
 */
function isInteractable(el: HTMLElement): boolean {
  // Check for the HTML `disabled` attribute (applies to input, textarea,
  // button, select, etc.).
  if ((el as HTMLInputElement).disabled) return false;

  // Check for `readonly` (only meaningful on input/textarea, but safe).
  if ((el as HTMLInputElement).readOnly) return false;

  // Check visibility — computed display: none means the element isn't
  // rendered, and visibility: hidden means it's not interactable.
  const style = window.getComputedStyle(el);
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
 * Use the native property setter so framework-managed inputs (React in
 * particular) register the change. Setting `.value` directly bypasses
 * React's synthetic property descriptor; calling the native setter
 * triggers React's change tracking.
 */
function setNativeValue(
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
function dispatchInputEvents(el: HTMLElement): void {
  el.dispatchEvent(
    new Event("input", { bubbles: true, cancelable: true }),
  );
  el.dispatchEvent(
    new Event("change", { bubbles: true, cancelable: true }),
  );
}

/**
 * Attempt form submission. Prefer `form.requestSubmit()` (triggers
 * validation and submit events naturally). Fall back to dispatching an
 * Enter keydown on the element itself.
 */
function triggerSubmit(el: HTMLElement): void {
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

// ── Stub DOM operation handlers ─────────────────────────────────────────
//
// These stubs return { status: "not_implemented" } so the caller gets a
// uniform response until the individual tasks (T007–T011, T013) fill in the
// real implementations.
// The `read` and `click` handlers are the exception — already implemented.

async function navigateHandler(_params: unknown): Promise<unknown> {
  const params = _params as Record<string, unknown> | null | undefined;
  if (!params || typeof params.url !== "string") {
    return {
      error: {
        code: "INVALID_URL",
        message: "Missing or invalid 'url' parameter.",
      },
    };
  }

  const url = params.url;
  const waitUntil = (params.waitUntil as string | undefined) ?? "load";
  const timeoutMs = (params.timeout as number | undefined) ?? 30000;

  // ── Validate URL format ───────────────────────────────────────────────
  let targetUrl: URL;
  try {
    targetUrl = new URL(url);
  } catch {
    return {
      error: {
        code: "INVALID_URL",
        message: `Invalid URL format: "${url}"`,
        suggestion: "Provide a fully-qualified URL like https://example.com",
      },
    };
  }

  // ── Block restricted schemes ──────────────────────────────────────────
  const RESTRICTED_RE = /^(chrome|chrome-extension|edge|brave|about):\/\//i;
  if (RESTRICTED_RE.test(targetUrl.href)) {
    return {
      error: {
        code: "RESTRICTED_URL",
        message: `Navigation to "${targetUrl.protocol}//" URLs is blocked.`,
        suggestion: "Use https:// URLs for web pages.",
      },
    };
  }

  // ── Detect same-page vs cross-page navigation ─────────────────────────
  // If only the hash differs, we can handle it in-page with full waitUntil
  // support. Otherwise, the navigation destroys this content script so we
  // return immediately and let the background (service worker) handle the
  // post-navigation page-info query.
  const currentUrl = new URL(window.location.href);
  const isSamePage =
    targetUrl.origin === currentUrl.origin &&
    targetUrl.pathname === currentUrl.pathname &&
    targetUrl.search === currentUrl.search;

  if (isSamePage) {
    // Same-page (hash-only) navigation — handle fully in-page.
    return handleSamePageNavigation(targetUrl, waitUntil, timeoutMs);
  }

  // ── Cross-page navigation ─────────────────────────────────────────────
  // The service worker handles cross-page navigation via chrome.tabs.update.
  // We set location.href and return immediately before the page is destroyed.
  window.location.href = targetUrl.href;
  return { status: "navigating", url: targetUrl.href };
}

/**
 * Handle same-page (hash-only) navigation with full waitUntil support.
 */
async function handleSamePageNavigation(
  targetUrl: URL,
  waitUntil: string,
  timeoutMs: number,
): Promise<unknown> {
  // Set the hash — this won't destroy the content script.
  window.location.hash = targetUrl.hash;

  // If the hash is empty, we're already at the target.
  if (!targetUrl.hash || targetUrl.hash === "#") {
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
 * Wait for a specific page-load lifecycle event.
 *
 * - "load" → window.load event
 * - "domcontentloaded" → DOMContentLoaded event (or resolve immediately if
 *   document.readyState is already "interactive" or "complete")
 * - "networkidle" → poll performance.getEntriesByType('resource') until
 *   500ms pass with no new entries.
 */
function waitForLoadEvent(
  waitUntil: string,
  timeoutMs: number,
): Promise<void> {
  if (waitUntil === "load") {
    return waitForEvent("load", timeoutMs);
  }

  if (waitUntil === "domcontentloaded") {
    // If the document is already interactive or complete, resolve immediately.
    if (document.readyState === "interactive" || document.readyState === "complete") {
      return Promise.resolve();
    }
    return waitForEvent("DOMContentLoaded", timeoutMs);
  }

  // "networkidle" — poll resource timing entries
  return waitForNetworkIdle(timeoutMs);
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

/** Sleep helper (synchronous-style via Promise). */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Wrap a promise with a timeout. Rejects with an Error if the timeout is
 * reached before the promise settles.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms),
    ),
  ]);
}

// ── Click handler (T010) ────────────────────────────────────────────────

/**
 * Click an element identified by CSS selector, with optional text-based
 * disambiguation.
 *
 * Phases:
 *  1. Wait for the element to appear (polling up to `timeout` ms).
 *  2. If a text filter is provided, find the match whose textContent
 *     includes the filter string (case-insensitive, trimmed).
 *  3. Validate the element is visible and enabled.
 *  4. Scroll it into view, click it, then detect navigation.
 */
async function clickHandler(
  params: unknown,
): Promise<ClickSuccess | ClickError> {
  // ── Validate parameters ────────────────────────────────────────────
  if (typeof params !== "object" || params === null) {
    return {
      clicked: false,
      code: "ELEMENT_NOT_FOUND",
      message: "Invalid parameters: expected an object with selector, text?, timeout?.",
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
    const allMatches = document.querySelectorAll(selector);
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
  const previousUrl = window.location.href;
  const previousTitle = document.title;

  (element as HTMLElement).click();

  // Wait then check whether navigation occurred
  await sleep(300);

  const navigated = window.location.href !== previousUrl;
  const elementText = element.textContent?.trim() ?? "";

  const result: ClickSuccess = {
    clicked: true,
    selector,
    text: elementText,
    navigated,
  };

  if (navigated) {
    result.newTitle = document.title;
    result.newUrl = window.location.href;
  }

  return result;
}

// ── Click helpers ──────────────────────────────────────────────────────

/** Poll until a click target matching `selector` (and optionally `textFilter`) appears, or timeout. */
async function waitForClickTarget(
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

/** Query the DOM for a click target matching selector and optional text filter. */
function findClickTarget(
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

/** Check whether an element is visible and enabled (click-specific). */
function isClickable(el: Element): boolean {
  const htmlEl = el as HTMLElement;

  // Check for explicit hidden state
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
  if (
    "disabled" in htmlEl &&
    (htmlEl as HTMLButtonElement).disabled === true
  ) {
    return false;
  }

  // Check aria-disabled
  if (htmlEl.getAttribute("aria-disabled") === "true") {
    return false;
  }

  return true;
}

/**
 * Type handler — full implementation (T011).
 *
 * Locates an element by CSS selector, validates it is a typable,
 * interactable element, focuses it, sets the value (clearing first if
 * requested), dispatches framework-compatible events, and optionally
 * submits the surrounding form.
 */
async function typeHandler(params: unknown): Promise<TypeSuccess | TypeError> {
  const p = params as TypeParams;
  const { selector, text } = p;
  const clear = p.clear ?? true;
  const submit = p.submit ?? false;
  const timeout = p.timeout ?? 10000;

  // ── Locate element (with timeout) ───────────────────────────────────
  let el: Element;
  try {
    const result = await waitForElement(selector, timeout);
    el = result.element;
    console.log(
      `[pi-browser-bridge] waitForElement "${selector}" took ${result.elapsedMs}ms`,
    );
  } catch {
    // Collect matching typable elements as suggestions for the LLM.
    const allTypable = document.querySelectorAll(
      'input:not([type="hidden"]), textarea, [contenteditable="true"]',
    );
    const suggestions = Array.from(allTypable)
      .map((el) => {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : "";
        const cls = (el.className && typeof el.className === "string")
          ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
          : "";
        const name = el.getAttribute("name") ? `[name="${el.getAttribute("name")}"]` : "";
        const placeholder = el.getAttribute("placeholder")
          ? ` (placeholder: "${el.getAttribute("placeholder")!.slice(0, 30)}")`
          : "";
        return `<${tag}${id}${cls}${name}>${placeholder}`;
      })
      .slice(0, 10);

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
      el.dispatchEvent(
        new Event("input", { bubbles: true, cancelable: true }),
      );
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
    ? htmlEl.textContent ?? ""
    : (el as HTMLInputElement | HTMLTextAreaElement).value;

  return {
    typed: true,
    selector,
    value: finalValue,
  };
}

// ── Text extraction helpers ───────────────────────────────────────────

/** HTML elements whose subtree is never traversed for text. */
const SKIP_TAGS = new Set(["script", "style", "noscript", "svg", "canvas", "video", "audio", "iframe", "template"]);

/** Elements that produce block-level line breaks in the output. */
const BLOCK_TAGS = new Set(["p", "div", "section", "article", "aside", "header", "footer", "nav", "main", "form", "fieldset", "figure", "figcaption", "details", "summary", "dialog", "pre", "blockquote", "hr", "table", "ul", "ol", "dl", "h1", "h2", "h3", "h4", "h5", "h6"]);

/** Check whether an element is hidden from the user. */
function isHidden(el: Element): boolean {
  const style = getComputedStyle(el);
  return style.display === "none" || style.visibility === "hidden" || style.opacity === "0";
}

/** Safely collapse whitespace into a single space for inline text runs. */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Build a human-friendly representation of an <a> element's href. */
function linkAnnotation(el: HTMLAnchorElement): string {
  const href = el.getAttribute("href") ?? "";
  if (!href || href.startsWith("#")) return "";
  const display = href.length > 80 ? href.slice(0, 77) + "…" : href;
  return ` [${display}]`;
}

/** Best-effort label inference for form controls. */
function inferLabel(el: Element): string {
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

// ── Core DOM text extractor ────────────────────────────────────────────

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

    if (inputType === "submit" || inputType === "button" || inputType === "reset") {
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

  if (hasAriaLabel && !isLink && !isHeading && !isParagraph && !isListItem && !isListContainer) {
    state.parts.push(`[${ariaLabel}]`);
    state.totalChars += ariaLabel!.length + 3;
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

function extractText(root: Element, maxLength: number): { text: string; length: number; truncated: boolean } {
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

// ── Read handler ──────────────────────────────────────────────────────

async function readHandler(_params: unknown): Promise<unknown> {
  const params = _params as Record<string, unknown> | null | undefined;
  const selector = typeof params?.selector === "string" ? params.selector : undefined;
  const maxLength =
    typeof params?.maxLength === "number" && Number.isFinite(params.maxLength) && params.maxLength > 0
      ? Math.floor(params.maxLength)
      : 50_000;

  let root: Element | null;
  if (selector) {
    try {
      root = document.querySelector(selector);
    } catch {
      return {
        error: {
          code: "ELEMENT_NOT_FOUND",
          message: `Invalid CSS selector: "${selector}"`,
          suggestion: "Check the selector syntax. Use valid CSS selectors like '#id', '.class', or 'tag'.",
        },
      };
    }

    if (!root) {
      return {
        error: {
          code: "ELEMENT_NOT_FOUND",
          message: `No element matching selector "${selector}" found on the page.`,
          suggestion:
            "Try a different selector. Common issues: the element might be inside a shadow DOM, an iframe, or loaded dynamically after page load.",
        },
      };
    }
  } else {
    root = document.body;
    if (!root) {
      return { text: "", length: 0 };
    }
  }

  const result = extractText(root, maxLength);
  return result;
}

// ── Wait-for-element handler (T013) ────────────────────────────────────

/** Parameters for the `waitForElement` action. */
interface WaitForElementParams {
  selector: string;
  timeout?: number;
}

/** Successful `waitForElement` result. */
interface WaitForElementSuccess {
  found: true;
  elapsedMs: number;
  selector: string;
  tagName: string;
}

/** Timed-out `waitForElement` result. */
interface WaitForElementError {
  found: false;
  elapsedMs: number;
  selector: string;
  error: ErrorCode;
  message: string;
}

async function waitForElementHandler(
  params: unknown,
): Promise<WaitForElementSuccess | WaitForElementError> {
  const p = params as WaitForElementParams | null | undefined;
  const selector = p?.selector;
  const timeout =
    typeof p?.timeout === "number" && Number.isFinite(p.timeout) && p.timeout > 0
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

  console.log(
    `[pi-browser-bridge] waitForElement: waiting for "${selector}" (timeout=${timeout}ms)`,
  );

  try {
    const result = await waitForElement(selector, timeout);
    console.log(
      `[pi-browser-bridge] waitForElement: found "${selector}" in ${result.elapsedMs}ms`,
    );
    return {
      found: true,
      elapsedMs: result.elapsedMs,
      selector,
      tagName: result.element.tagName.toLowerCase(),
    };
  } catch {
    console.log(
      `[pi-browser-bridge] waitForElement: timeout waiting for "${selector}" after ${timeout}ms`,
    );
    return {
      found: false,
      elapsedMs: timeout,
      selector,
      error: "TIMEOUT",
      message: `Element "${selector}" not found within ${timeout}ms.`,
    };
  }
}

// ── Wait-for-text handler (T013) ───────────────────────────────────────

/** Parameters for the `waitForText` action. */
interface WaitForTextParams {
  text: string;
  scope?: string;
  timeout?: number;
}

/** Successful `waitForText` result. */
interface WaitForTextSuccess {
  found: true;
  elapsedMs: number;
  text: string;
}

/** Timed-out `waitForText` result. */
interface WaitForTextError {
  found: false;
  elapsedMs: number;
  text: string;
  error: ErrorCode;
  message: string;
}

async function waitForTextHandler(
  params: unknown,
): Promise<WaitForTextSuccess | WaitForTextError> {
  const p = params as WaitForTextParams | null | undefined;
  const text = p?.text;
  const scope = typeof p?.scope === "string" && p.scope.length > 0 ? p.scope : undefined;
  const timeout =
    typeof p?.timeout === "number" && Number.isFinite(p.timeout) && p.timeout > 0
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

  const scopeLabel = scope ? ` within "${scope}"` : "";
  console.log(
    `[pi-browser-bridge] waitForText: waiting for "${text}"${scopeLabel} (timeout=${timeout}ms)`,
  );

  try {
    const result = await waitForText(text, scope, timeout);
    console.log(
      `[pi-browser-bridge] waitForText: found "${text}" in ${result.elapsedMs}ms`,
    );
    return {
      found: true,
      elapsedMs: result.elapsedMs,
      text,
    };
  } catch {
    console.log(
      `[pi-browser-bridge] waitForText: timeout waiting for "${text}" after ${timeout}ms`,
    );
    return {
      found: false,
      elapsedMs: timeout,
      text,
      error: "TIMEOUT",
      message: `Text "${text}" not found${scopeLabel} within ${timeout}ms.`,
    };
  }
}

async function screenshotHandler(_params: unknown): Promise<unknown> {
  return { status: "not_implemented" };
}

// ── Exec handler (T019) ───────────────────────────────────────────────

type ExecSuccessResult = ExecResult;
type ExecErrorPayload = { error: { code: ErrorCode; message: string; suggestion?: string } };
type ExecResponse = ExecSuccessResult | ExecErrorPayload;

/**
 * Serialise an arbitrary JavaScript value into a human-readable string.
 *
 * - Primitives are returned as-is (`undefined` → `"undefined"`).
 * - Objects/arrays use `JSON.stringify` with a replacer that handles
 *   circular references (`"[Circular]"`), functions (`"[Function: name]"`),
 *   symbols (`"[Symbol: description]"`), and bigints (`.toString()`).
 * - Once serialised, output is capped at {@link MAX_EXEC_OUTPUT} characters.
 */
function serializeExecValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  const t = typeof value;
  if (t === "string") return value as string;
  if (t === "number") return String(value as number);
  if (t === "boolean") return String(value as boolean);
  if (t === "bigint") return `${(value as bigint).toString()}n`;
  if (t === "symbol") {
    const desc = (value as symbol).description;
    return desc ? `[Symbol: ${desc}]` : "[Symbol]";
  }
  if (t === "function") {
    const name = (value as (...args: unknown[]) => unknown).name || "anonymous";
    return `[Function: ${name}]`;
  }

  // Object or array — try native JSON.stringify first, then fall back to
  // a custom replacer that catches circular refs and non-serialisable types.
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    const seen = new WeakSet<object>();
    return JSON.stringify(
      value,
      (_key, val: unknown) => {
        if (val === undefined) return "undefined";
        if (typeof val === "function") {
          return `[Function: ${val.name || "anonymous"}]`;
        }
        if (typeof val === "symbol") {
          const desc = (val as symbol).description;
          return desc ? `[Symbol: ${desc}]` : "[Symbol]";
        }
        if (typeof val === "bigint") return `${val.toString()}n`;
        if (typeof val === "object" && val !== null) {
          if (seen.has(val)) return "[Circular]";
          seen.add(val);
        }
        return val;
      },
      2,
    );
  }
}

/** Maximum characters before the serialised output is truncated. */
const MAX_EXEC_OUTPUT = 10_000;

/**
 * Execute the user-supplied JavaScript and return a serialised representation
 * of its result. Async code (Promises) is awaited with a 5 s timeout.
 */
async function execHandler(params: unknown): Promise<ExecResponse> {
  const p = params as { code?: string } | null | undefined;
  if (!p || typeof p.code !== "string" || p.code.trim().length === 0) {
    return {
      error: {
        code: "UNKNOWN_ACTION",
        message: "Missing or invalid 'code' parameter.",
        suggestion: "Provide a string of JavaScript code to execute.",
      },
    };
  }

  const code = p.code;
  const TIMEOUT_MS = 5_000;

  // ── Evaluate the user code ───────────────────────────────────────────
  let raw: unknown;
  try {
    raw = (0, eval)(code);
  } catch (syncErr) {
    const msg = syncErr instanceof Error ? syncErr.message : String(syncErr);
    return {
      value: undefined,
      serialized: `Error: ${msg}`,
    };
  }

  // If the evaluated code returned a thenable, await it with timeout.
  if (
    raw !== null &&
    typeof raw === "object" &&
    typeof (raw as Promise<unknown>).then === "function"
  ) {
    try {
      raw = await withTimeout(raw as Promise<unknown>, TIMEOUT_MS);
    } catch (asyncErr) {
      const msg =
        asyncErr instanceof Error ? asyncErr.message : String(asyncErr);
      return {
        value: undefined,
        serialized: `Error: ${msg}`,
      };
    }
  }

  // ── Serialise the result ─────────────────────────────────────────────
  const serializedFull = serializeExecValue(raw);

  let serialized: string;
  if (serializedFull.length > MAX_EXEC_OUTPUT) {
    serialized =
      serializedFull.slice(0, MAX_EXEC_OUTPUT) +
      `\n... [truncated at ${MAX_EXEC_OUTPUT} chars, total ${serializedFull.length}]`;
  } else {
    serialized = serializedFull;
  }

  return { value: raw, serialized };
}

// ── Handler registry ────────────────────────────────────────────────────
//
// Map<Action, handler> — adding a new tool only requires registering a
// handler here.  The message listener stays thin and never needs to change.

const handlers = new Map<string, ActionHandler>([
  ["navigate", navigateHandler],
  ["click", clickHandler],
  ["type", typeHandler],
  ["read", readHandler],
  ["waitForElement", waitForElementHandler],
  ["waitForText", waitForTextHandler],
  ["screenshot", screenshotHandler],
  ["exec", execHandler],
]);

// ── Helpers ─────────────────────────────────────────────────────────────

/** Build a structured error Response object. */
function errorResponse(
  id: string,
  code: ErrorCode,
  message: string,
  suggestion?: string,
): Response {
  return {
    id,
    error: { code, message, ...(suggestion ? { suggestion } : {}) },
  };
}

/** Log an incoming action and return metadata for the handler pipeline. */
function logAction(id: string, action: string): void {
  console.log(`[pi-browser-bridge] action: ${action} (id=${id})`);
}

// ── Message dispatcher ──────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  const msg = message as Record<string, unknown>;

  // ── Ping (service-worker injection check) ──────────────────────
  if (msg.type === "ping") {
    console.log("[pi-browser-bridge] ping received");
    sendResponse({ type: "pong" });
    return false; // synchronous — port closes immediately
  }

  // ── Heartbeat (explicit health check) ──────────────────────────
  if (msg.type === "heartbeat") {
    console.log("[pi-browser-bridge] heartbeat received");
    sendResponse({ status: "ok" });
    return false; // synchronous
  }

  // ── Action request ─────────────────────────────────────────────
  if ("id" in msg && "action" in msg) {
    const id = String(msg.id);
    const action = String(msg.action);
    const params = msg.params;

    logAction(id, action);

    const handler = handlers.get(action);
    if (!handler) {
      sendResponse(
        errorResponse(
          id,
          "UNKNOWN_ACTION",
          `Unknown action: "${action}"`,
          `Supported actions: ${[...handlers.keys()].join(", ")}`,
        ),
      );
      return false; // synchronous error — no async work needed
    }

    // Async domain check + handler pipeline — keep the port open (return true)
    (async () => {
      // ── Domain allowlist check (defence-in-depth) ──────────────────
      const allowed = await checkDomainAllowed();
      if (!allowed) {
        const hostname = window.location.hostname || "unknown";
        try {
          sendResponse(
            errorResponse(
              id,
              "RESTRICTED_DOMAIN",
              `Domain "${hostname}" is not in the allowlist.`,
              `Add "${hostname}" to the extension popup's domain allowlist, or set it to "*" to allow all domains.`,
            ),
          );
        } catch {
          // Port already closed.
        }
        return;
      }

      handler(params)
        .then((result) => {
          try {
            sendResponse({ id, result } satisfies Response);
          } catch {
            console.warn(
              "[pi-browser-bridge] Failed to send response (port already closed)",
            );
          }
        })
        .catch((err: unknown) => {
          const rawMessage =
            err instanceof Error ? err.message : String(err);
          console.error(
            `[pi-browser-bridge] Handler crashed for "${action}":`,
            rawMessage,
          );

          // Derive a more specific error code from the exception message.
          let code: ErrorCode = "UNKNOWN_ACTION";
          const lower = rawMessage.toLowerCase();
          if (lower.includes("timeout") || lower.includes("timed out")) {
            code = "TIMEOUT";
          } else if (lower.includes("not found") || lower.includes("selector")) {
            code = "ELEMENT_NOT_FOUND";
          } else if (
            lower.includes("interactable") ||
            lower.includes("disabled") ||
            lower.includes("hidden")
          ) {
            code = "ELEMENT_NOT_INTERACTABLE";
          }

          try {
            sendResponse(
              errorResponse(
                id,
                code,
                `Handler for "${action}" failed: ${rawMessage}`,
                "This is an unexpected error. Check the browser console for details.",
              ),
            );
          } catch {
            // Port already closed — nothing we can do.
          }
        });
    })();

    return true; // will call sendResponse asynchronously
  }

  // Unknown message shape — do not respond.
  return false;
});
