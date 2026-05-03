/**
 * Domain-level DOM constants.
 *
 * Shared by extractText, interaction handlers, and other pure DOM logic.
 *
 * @module domain/constants
 */

/** HTML elements whose subtree is never traversed for text extraction. */
export const SKIP_TAGS = new Set([
	"script",
	"style",
	"noscript",
	"svg",
	"canvas",
	"video",
	"audio",
	"iframe",
	"template",
]);

/** Elements that produce block-level line breaks in the output. */
export const BLOCK_TAGS = new Set([
	"p",
	"div",
	"section",
	"article",
	"aside",
	"header",
	"footer",
	"nav",
	"main",
	"form",
	"fieldset",
	"figure",
	"figcaption",
	"details",
	"summary",
	"dialog",
	"pre",
	"blockquote",
	"hr",
	"table",
	"ul",
	"ol",
	"dl",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
]);

/** Set of element tag names that accept typed input. */
export const TYPABLE_ELEMENTS = new Set(["INPUT", "TEXTAREA"]);

/** Polling interval for waitForElement / waitForText (ms). */
export const POLL_INTERVAL_MS = 100;
