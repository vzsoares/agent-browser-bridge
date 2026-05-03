/**
 * Domain layer — pure DOM manipulation logic.
 *
 * Zero Chrome API dependencies. All functions operate on standard
 * DOM APIs (document, window, Element, etc.) and are fully testable
 * with happy-dom / jsdom.
 *
 * @module domain
 */

export {
	globToRegex,
	matchDomain,
} from "./allowlist.js";

export {
	BLOCK_TAGS,
	POLL_INTERVAL_MS,
	SKIP_TAGS,
	TYPABLE_ELEMENTS,
} from "./constants.js";
export type {
	ExtractTextResult,
	WaitForElementResult,
	WaitForTextResult,
} from "./dom.js";
export {
	collapse,
	collectTypableSuggestions,
	dispatchInputEvents,
	extractText,
	findClickTarget,
	inferLabel,
	isClickable,
	isHidden,
	isInteractable,
	linkAnnotation,
	setNativeValue,
	sleep,
	triggerSubmit,
	waitForClickTarget,
	waitForElement,
	waitForText,
	withTimeout,
} from "./dom.js";
export type { DomainError, DomErrorCode, ErrorCode } from "./errors.js";
export {
	elementNotFoundError,
	elementNotInteractableError,
	elementNotTypableError,
	timeoutError,
} from "./errors.js";
export type {
	ClickError,
	ClickHandlerParams,
	ClickResult,
	ClickSuccess,
	TypeErrorResult,
	TypeResult,
	TypeSuccess,
} from "./interactions.js";
export {
	clickHandler,
	typeHandler,
} from "./interactions.js";
export {
	isRestrictedUrl,
	validateScreenshotParams,
} from "./screenshot.js";
export type {
	ScreenshotFormat,
	ScreenshotParams,
	ScreenshotValidationError,
	ValidScreenshotParams,
} from "./screenshot.js";
