/**
 * Zod schemas for browser-automation tool parameters.
 *
 * Each schema maps to the protocol-level parameter interfaces and provides
 * runtime validation with static type inference via `z.infer<typeof schema>`.
 *
 * Zero dependencies on infrastructure packages (Hono, ws, pi SDK).
 * Only imports: zod, protocol types.
 *
 * @module domain/schemas
 */

import { z } from "zod";

// ── Navigate ──────────────────────────────────────────────────────────────

export const NavigateSchema = z.object({
  tabId: z
    .number()
    .int()
    .optional()
    .describe(
      "Target tab ID. When omitted, defaults to the active tab or creates a new tab.",
    ),
  url: z
    .string()
    .min(1, "URL is required")
    .describe("Fully-qualified URL to navigate to (e.g. https://example.com)."),
  waitUntil: z
    .enum(["load", "domcontentloaded", "networkidle"])
    .default("load")
    .describe(
      "When to consider navigation complete. 'load' waits for the window.load event. " +
        "'domcontentloaded' and 'networkidle' are currently approximated as 'load' in v1.",
    ),
  timeout: z
    .number()
    .int()
    .min(1000, "Timeout must be at least 1000ms")
    .default(30000)
    .describe(
      "Maximum time to wait for navigation in milliseconds. Defaults to 30000 (30s).",
    ),
});

export type ValidatedNavigateParams = z.infer<typeof NavigateSchema>;

// ── Click ─────────────────────────────────────────────────────────────────

export const ClickSchema = z.object({
  tabId: z
    .number()
    .int()
    .optional()
    .describe(
      "Target tab ID. When omitted, defaults to the active tab.",
    ),
  selector: z
    .string()
    .min(1, "CSS selector is required")
    .describe("CSS selector of the element to click."),
  text: z
    .string()
    .optional()
    .describe(
      "Optional text content the element must contain. When provided, the first element " +
        "matching `selector` whose textContent includes this value (case-insensitive, trimmed) " +
        "is clicked. Useful for disambiguating multiple matches.",
    ),
  timeout: z
    .number()
    .int()
    .min(0, "Timeout must be >= 0")
    .default(10000)
    .describe("Maximum time to wait for the element to appear (ms)."),
});

export type ValidatedClickParams = z.infer<typeof ClickSchema>;

// ── Type ──────────────────────────────────────────────────────────────────

export const TypeSchema = z.object({
  tabId: z
    .number()
    .int()
    .optional()
    .describe(
      "Target tab ID. When omitted, defaults to the active tab.",
    ),
  selector: z
    .string()
    .min(1, "CSS selector is required")
    .describe("CSS selector of the input element to type into."),
  text: z
    .string()
    .describe("Text to type into the element."),
  clear: z
    .boolean()
    .default(true)
    .describe("Clear any existing value in the element before typing."),
  submit: z
    .boolean()
    .default(false)
    .describe("Press Enter or submit the form after typing."),
  timeout: z
    .number()
    .int()
    .min(0, "Timeout must be >= 0")
    .default(10000)
    .describe("Maximum time to wait for the element to appear (ms)."),
});

export type ValidatedTypeParams = z.infer<typeof TypeSchema>;

// ── Screenshot ────────────────────────────────────────────────────────────

export const ScreenshotSchema = z.object({
  tabId: z
    .number()
    .int()
    .optional()
    .describe(
      "Target tab ID. Defaults to the active tab when omitted.",
    ),
  format: z
    .enum(["png", "jpeg"])
    .default("png")
    .describe("Image format for the screenshot."),
  quality: z
    .number()
    .int()
    .min(0)
    .max(100)
    .default(80)
    .describe("JPEG quality (0–100). Only meaningful when format is 'jpeg'."),
  fullPage: z
    .boolean()
    .default(false)
    .describe(
      "Capture the full scrollable page. ⚠️ v1 limitation: only the visible viewport is captured.",
    ),
});

export type ValidatedScreenshotParams = z.infer<typeof ScreenshotSchema>;

// ── Read ──────────────────────────────────────────────────────────────────

export const ReadSchema = z.object({
  tabId: z
    .number()
    .int()
    .optional()
    .describe(
      "Target tab ID. When omitted, defaults to the active tab.",
    ),
  selector: z
    .string()
    .optional()
    .describe(
      "CSS selector to scope the read operation. When omitted, the entire page body is read.",
    ),
  maxLength: z
    .number()
    .int()
    .min(1, "maxLength must be >= 1")
    .default(50000)
    .describe(
      "Maximum number of characters to return. Text beyond this limit is truncated with a summary note.",
    ),
});

export type ValidatedReadParams = z.infer<typeof ReadSchema>;

// ── Exec ──────────────────────────────────────────────────────────────────

export const ExecSchema = z.object({
  tabId: z
    .number()
    .int()
    .optional()
    .describe(
      "Target tab ID. When omitted, defaults to the active tab.",
    ),
  code: z
    .string()
    .min(1, "JavaScript code is required")
    .describe(
      "JavaScript code to execute in the page context. Can access DOM APIs, global variables, " +
        "and return values. Async code (Promises) is awaited automatically.",
    ),
});

export type ValidatedExecParams = z.infer<typeof ExecSchema>;

// ── Wait For Element ──────────────────────────────────────────────────────

export const WaitForElementSchema = z.object({
  tabId: z
    .number()
    .int()
    .optional()
    .describe(
      "Target tab ID. When omitted, defaults to the active tab.",
    ),
  selector: z
    .string()
    .min(1, "CSS selector is required")
    .describe("CSS selector of the element to wait for."),
  timeout: z
    .number()
    .int()
    .min(0, "Timeout must be >= 0")
    .default(10000)
    .describe("Maximum time to wait for the element (ms)."),
});

export type ValidatedWaitForElementParams = z.infer<typeof WaitForElementSchema>;

// ── Wait For Text ─────────────────────────────────────────────────────────

export const WaitForTextSchema = z.object({
  tabId: z
    .number()
    .int()
    .optional()
    .describe(
      "Target tab ID. When omitted, defaults to the active tab.",
    ),
  text: z
    .string()
    .min(1, "Text is required")
    .describe("Case-sensitive text content to wait for."),
  scope: z
    .string()
    .optional()
    .describe(
      "Optional CSS selector to limit the search scope. When omitted, the entire page body is searched.",
    ),
  timeout: z
    .number()
    .int()
    .min(0, "Timeout must be >= 0")
    .default(10000)
    .describe("Maximum time to wait for the text (ms)."),
});

export type ValidatedWaitForTextParams = z.infer<typeof WaitForTextSchema>;

// ── Create Tab ────────────────────────────────────────────────────────────

export const CreateTabSchema = z.object({
  url: z
    .string()
    .optional()
    .describe(
      "URL to open in the new tab. When omitted, opens a blank tab.",
    ),
  active: z
    .boolean()
    .default(true)
    .describe(
      "Whether the new tab should become the active (foreground) tab. Defaults to true.",
    ),
});

export type ValidatedCreateTabParams = z.infer<typeof CreateTabSchema>;

// ── List Tabs ────────────────────────────────────────────────────────────

export const ListTabsSchema = z.object({
	urlPattern: z
		.string()
		.optional()
		.describe(
			"Filter tabs by URL or title substring match. Omit to list all tabs.",
		),
	currentWindowOnly: z
		.boolean()
		.default(true)
		.describe(
			"Only list tabs in the current browser window. Defaults to true.",
		),
});

export type ValidatedListTabsParams = z.infer<typeof ListTabsSchema>;

// ── Close Tab ────────────────────────────────────────────────────────────

export const CloseTabSchema = z.object({
	tabId: z
		.number()
		.int()
		.describe("ID of the tab to close. Use browser_list_tabs to find tab IDs."),
});

export type ValidatedCloseTabParams = z.infer<typeof CloseTabSchema>;
