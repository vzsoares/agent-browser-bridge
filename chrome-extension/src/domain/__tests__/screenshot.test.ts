/**
 * Domain screenshot logic tests.
 *
 * Tests pure validation and URL restriction functions.
 * No Chrome API dependencies — runs in any JS runtime.
 *
 * @module domain/__tests__/screenshot.test
 */

import { describe, expect, test } from "vitest";
import {
  isRestrictedUrl,
  validateScreenshotParams,
  type ValidScreenshotParams,
  type ScreenshotValidationError,
} from "../screenshot.js";

// ── isRestrictedUrl ──────────────────────────────────────────────────────

describe("isRestrictedUrl", () => {
  test("returns true for chrome:// URLs", () => {
    expect(isRestrictedUrl("chrome://extensions")).toBe(true);
    expect(isRestrictedUrl("chrome://settings")).toBe(true);
  });

  test("returns true for chrome-extension:// URLs", () => {
    expect(isRestrictedUrl("chrome-extension://abc123/popup.html")).toBe(true);
  });

  test("returns true for edge:// URLs", () => {
    expect(isRestrictedUrl("edge://settings")).toBe(true);
  });

  test("returns true for brave:// URLs", () => {
    expect(isRestrictedUrl("brave://downloads")).toBe(true);
  });

  test("returns true for about:// URLs", () => {
    // about:blank doesn't have :// so it won't match — that's expected
    expect(isRestrictedUrl("about://config")).toBe(true);
  });

  test("returns false for https:// URLs", () => {
    expect(isRestrictedUrl("https://example.com")).toBe(false);
    expect(isRestrictedUrl("https://google.com")).toBe(false);
  });

  test("returns false for http:// URLs", () => {
    expect(isRestrictedUrl("http://localhost:3000")).toBe(false);
  });

  test("returns false for file:// URLs", () => {
    expect(isRestrictedUrl("file:///Users/test/index.html")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isRestrictedUrl("")).toBe(false);
  });

  test("is case-insensitive", () => {
    expect(isRestrictedUrl("CHROME://extensions")).toBe(true);
    expect(isRestrictedUrl("Chrome://Settings")).toBe(true);
  });
});

// ── validateScreenshotParams ─────────────────────────────────────────────

describe("validateScreenshotParams", () => {
  test("returns defaults for null input", () => {
    const result = validateScreenshotParams(null);
    expect(isValid(result)).toBe(true);
    const p = result as ValidScreenshotParams;
    expect(p.format).toBe("png");
    expect(p.fullPage).toBe(false);
  });

  test("returns defaults for undefined input", () => {
    const result = validateScreenshotParams(undefined);
    expect(isValid(result)).toBe(true);
    const p = result as ValidScreenshotParams;
    expect(p.format).toBe("png");
    expect(p.fullPage).toBe(false);
  });

  test("returns defaults for non-object input", () => {
    const result = validateScreenshotParams("string");
    expect(isValid(result)).toBe(true);
    const p = result as ValidScreenshotParams;
    expect(p.format).toBe("png");
    expect(p.fullPage).toBe(false);
  });

  test("accepts valid png format", () => {
    const result = validateScreenshotParams({ format: "png" });
    expect(isValid(result)).toBe(true);
    const p = result as ValidScreenshotParams;
    expect(p.format).toBe("png");
  });

  test("accepts valid jpeg format", () => {
    const result = validateScreenshotParams({ format: "jpeg" });
    expect(isValid(result)).toBe(true);
    const p = result as ValidScreenshotParams;
    expect(p.format).toBe("jpeg");
  });

  test("accepts empty params object", () => {
    const result = validateScreenshotParams({});
    expect(isValid(result)).toBe(true);
    const p = result as ValidScreenshotParams;
    expect(p.format).toBe("png");
  });

  test("rejects invalid format", () => {
    const result = validateScreenshotParams({ format: "gif" });
    expect(isValid(result)).toBe(false);
    const err = result as ScreenshotValidationError;
    expect(err.code).toBe("UNKNOWN_ACTION");
    expect(err.message).toContain("format");
    expect(err.message).toContain("gif");
  });

  test("rejects numeric format", () => {
    const result = validateScreenshotParams({ format: 123 });
    expect(isValid(result)).toBe(false);
    const err = result as ScreenshotValidationError;
    expect(err.message).toContain("format");
  });

  test("accepts valid jpeg quality=80", () => {
    const result = validateScreenshotParams({ format: "jpeg", quality: 80 });
    expect(isValid(result)).toBe(true);
    const p = result as ValidScreenshotParams;
    expect(p.format).toBe("jpeg");
    expect(p.quality).toBe(80);
  });

  test("accepts jpeg quality=0 (minimum)", () => {
    const result = validateScreenshotParams({ format: "jpeg", quality: 0 });
    expect(isValid(result)).toBe(true);
    const p = result as ValidScreenshotParams;
    expect(p.quality).toBe(0);
  });

  test("accepts jpeg quality=100 (maximum)", () => {
    const result = validateScreenshotParams({ format: "jpeg", quality: 100 });
    expect(isValid(result)).toBe(true);
    const p = result as ValidScreenshotParams;
    expect(p.quality).toBe(100);
  });

  test("rejects jpeg quality=101 (over max)", () => {
    const result = validateScreenshotParams({ format: "jpeg", quality: 101 });
    expect(isValid(result)).toBe(false);
    const err = result as ScreenshotValidationError;
    expect(err.message).toContain("quality");
  });

  test("rejects negative quality", () => {
    const result = validateScreenshotParams({ format: "jpeg", quality: -1 });
    expect(isValid(result)).toBe(false);
    const err = result as ScreenshotValidationError;
    expect(err.message).toContain("quality");
  });

  test("rejects non-numeric quality", () => {
    const result = validateScreenshotParams({
      format: "jpeg",
      quality: "high",
    });
    expect(isValid(result)).toBe(false);
    const err = result as ScreenshotValidationError;
    expect(err.message).toContain("quality");
  });

  test("rejects NaN quality", () => {
    const result = validateScreenshotParams({ format: "jpeg", quality: NaN });
    expect(isValid(result)).toBe(false);
    const err = result as ScreenshotValidationError;
    expect(err.message).toContain("quality");
  });

  test("rejects Infinity quality", () => {
    const result = validateScreenshotParams({
      format: "jpeg",
      quality: Infinity,
    });
    expect(isValid(result)).toBe(false);
    const err = result as ScreenshotValidationError;
    expect(err.message).toContain("quality");
  });

  test("ignores quality for png format", () => {
    const result = validateScreenshotParams({ format: "png", quality: 50 });
    expect(isValid(result)).toBe(true);
    const p = result as ValidScreenshotParams;
    expect(p.format).toBe("png");
    expect(p.quality).toBeUndefined(); // quality only for jpeg
  });

  test("accepts fullPage=true", () => {
    const result = validateScreenshotParams({ fullPage: true });
    expect(isValid(result)).toBe(true);
    const p = result as ValidScreenshotParams;
    expect(p.fullPage).toBe(true);
  });

  test("accepts fullPage=false", () => {
    const result = validateScreenshotParams({ fullPage: false });
    expect(isValid(result)).toBe(true);
    const p = result as ValidScreenshotParams;
    expect(p.fullPage).toBe(false);
  });

  test("coerces fullPage to boolean", () => {
    const result = validateScreenshotParams({ fullPage: "yes" });
    expect(isValid(result)).toBe(true);
    const p = result as ValidScreenshotParams;
    expect(p.fullPage).toBe(true);
    expect(typeof p.fullPage).toBe("boolean");
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────

function isValid(
  result: ValidScreenshotParams | ScreenshotValidationError,
): result is ValidScreenshotParams {
  return !("code" in result);
}
