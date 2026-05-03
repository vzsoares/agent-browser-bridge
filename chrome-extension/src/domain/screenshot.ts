/**
 * Screenshot domain logic — pure validation and URL restriction checks.
 *
 * Zero Chrome API dependencies. All functions operate on plain strings
 * and primitive types and are fully testable with any JS runtime.
 *
 * @module domain/screenshot
 */

// ── Constants ────────────────────────────────────────────────────────────

/** URL prefixes that are blocked from screenshots and content-script injection. */
const RESTRICTED_URL_RE = /^(chrome|chrome-extension|about|edge|brave):\/\//i;

// ── Types ────────────────────────────────────────────────────────────────

/** Valid screenshot output formats. */
export type ScreenshotFormat = "png" | "jpeg";

/** Raw (pre-validation) screenshot parameters. */
export interface ScreenshotParams {
  format?: unknown;
  quality?: unknown;
  fullPage?: unknown;
}

/** Validated screenshot parameters ready for capture. */
export interface ValidScreenshotParams {
  format: ScreenshotFormat;
  /** JPEG quality 0‑100. Undefined for PNG. */
  quality?: number;
  /** Whether a full-page capture was requested (viewport-only in v1). */
  fullPage: boolean;
}

/** Validation error returned when parameters are invalid. */
export interface ScreenshotValidationError {
  code: string;
  message: string;
  suggestion?: string;
}

// ── URL restriction ──────────────────────────────────────────────────────

/**
 * Test whether a URL is a restricted browser-internal page
 * (chrome://, edge://, brave://, about://, chrome-extension://).
 *
 * These pages cannot be screenshotted or injected with content scripts.
 */
export function isRestrictedUrl(url: string): boolean {
  return RESTRICTED_URL_RE.test(url);
}

// ── Parameter validation ─────────────────────────────────────────────────

/**
 * Validate screenshot parameters.
 *
 * Checks that format is `"png"` or `"jpeg"`, quality is an integer 0–100
 * (only meaningful for jpeg), and fullPage is a boolean.
 *
 * @param params — Raw (untrusted) screenshot parameters from the client.
 * @returns Validated params, or a {@link ScreenshotValidationError}.
 */
export function validateScreenshotParams(
  params: unknown,
): ValidScreenshotParams | ScreenshotValidationError {
  // ── Null / non-object — use defaults ─────────────────────────────────
  if (typeof params !== "object" || params === null) {
    return { format: "png", fullPage: false };
  }

  const p = params as Record<string, unknown>;

  // ── Validate format ──────────────────────────────────────────────────
  let format: ScreenshotFormat = "png";
  if (p.format !== undefined) {
    if (p.format !== "png" && p.format !== "jpeg") {
      return {
        code: "UNKNOWN_ACTION",
        message: `Invalid screenshot format: "${String(p.format)}". Expected "png" or "jpeg".`,
        suggestion: 'Use "png" (default) or "jpeg".',
      };
    }
    format = p.format as ScreenshotFormat;
  }

  // ── Validate quality (jpeg only) ──────────────────────────────────────
  let quality: number | undefined;
  if (format === "jpeg" && p.quality !== undefined) {
    if (
      typeof p.quality !== "number" ||
      !Number.isFinite(p.quality) ||
      p.quality < 0 ||
      p.quality > 100
    ) {
      return {
        code: "UNKNOWN_ACTION",
        message: `Invalid screenshot quality: ${String(p.quality)}. Expected an integer between 0 and 100.`,
        suggestion:
          "Quality must be an integer between 0 and 100 (default: 80).",
      };
    }
    quality = p.quality;
  }

  // ── Validate fullPage ─────────────────────────────────────────────────
  const fullPage = Boolean(p.fullPage);

  return { format, quality, fullPage };
}
