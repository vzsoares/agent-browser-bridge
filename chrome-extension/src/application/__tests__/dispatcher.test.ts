/**
 * Message dispatcher routing tests.
 *
 * Verifies the content-script dispatcher correctly routes its action types to their
 * handlers and returns structured UNKNOWN_ACTION errors for unknown actions.
 *
 * @module application/__tests__/dispatcher.test
 */

import type { ErrorResponse } from "@agent-browser-bridge/protocol";
import { describe, expect, test } from "vitest";
import { ALL_ACTIONS, dispatch } from "../dispatcher.js";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Check if a value is an ErrorResponse. */
function isErrorResponse(v: unknown): v is ErrorResponse {
	return typeof v === "object" && v !== null && "code" in v && "message" in v;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("Message dispatcher", () => {
	describe("ALL_ACTIONS constant", () => {
		// `exec` is intentionally excluded — handled at the service-worker
		// level via chrome.scripting in the MAIN world, not via the
		// content-script dispatcher.
		test("contains exactly 6 action types", () => {
			expect(ALL_ACTIONS).toHaveLength(6);
		});

		test("includes all expected action names", () => {
			expect(ALL_ACTIONS).toContain("navigate");
			expect(ALL_ACTIONS).toContain("click");
			expect(ALL_ACTIONS).toContain("type");
			expect(ALL_ACTIONS).toContain("read");
			expect(ALL_ACTIONS).toContain("waitForElement");
			expect(ALL_ACTIONS).toContain("waitForText");
		});

		test("does NOT include exec (handled in service worker)", () => {
			expect(ALL_ACTIONS).not.toContain("exec");
		});
	});

	describe("routing all content-script action types", () => {
		test("routes 'navigate' action", async () => {
			// With a valid URL, handleNavigate either returns a same-page success,
			// a cross-page sentinel, or a validation error.
			const result = await dispatch("navigate", { url: "https://example.com" });
			expect(result).toBeDefined();
			expect(typeof result).toBe("object");
			expect(result).not.toBeNull();

			const r = result as Record<string, unknown>;
			// Cross-page navigation returns { status: "navigating", url: "..." }
			// Same-page returns { url, title }
			// Invalid returns { code, message }
			const isValidResult =
				r.status === "navigating" ||
				(typeof r.url === "string" && typeof r.title === "string") ||
				isErrorResponse(result);
			expect(isValidResult).toBe(true);

			// Specifically for a non-about:blank target from about:blank,
			// it should be cross-page.
			if (r.status === "navigating") {
				// happy-dom normalizes URLs with trailing slashes
				expect(r.url).toContain("https://example.com");
			}
		});

		test("routes 'click' action", async () => {
			const result = await dispatch("click", {
				selector: "#nonexistent",
				timeout: 10,
			});
			expect(result).toBeDefined();
			const r = result as Record<string, unknown>;
			expect(r).toHaveProperty("clicked");
			expect(r.clicked).toBe(false);
		});

		test("routes 'type' action", async () => {
			const result = await dispatch("type", {
				selector: "#nonexistent",
				text: "hello",
				timeout: 10,
			});
			const r = result as Record<string, unknown>;
			expect(r).toHaveProperty("typed");
			expect(r.typed).toBe(false);
		});

		test("routes 'read' action", async () => {
			const result = await dispatch("read", {});
			const r = result as Record<string, unknown>;
			// With empty body in happy-dom (or body with no content):
			expect(r).toHaveProperty("text");
			expect(r).toHaveProperty("length");
			expect(r).toHaveProperty("truncated");
		});

		test("dispatching 'exec' returns UNKNOWN_ACTION (handled in service worker)", async () => {
			const result = await dispatch("exec", { code: "1 + 2" });
			const r = result as Record<string, unknown>;
			expect(r).toHaveProperty("code", "UNKNOWN_ACTION");
		});

		test("routes 'waitForElement' action", async () => {
			const result = await dispatch("waitForElement", {
				selector: "div",
				timeout: 10,
			});
			const r = result as Record<string, unknown>;
			expect(r).toHaveProperty("found");
			expect(r.found).toBe(false);
		});

		test("routes 'waitForText' action", async () => {
			const result = await dispatch("waitForText", {
				text: "nonexistent",
				timeout: 10,
			});
			const r = result as Record<string, unknown>;
			expect(r).toHaveProperty("found");
			expect(r.found).toBe(false);
		});
	});

	describe("unknown action", () => {
		test("returns UNKNOWN_ACTION for unsupported action name", async () => {
			const result = await dispatch("unknownAction", {});
			expect(isErrorResponse(result)).toBe(true);
			const err = result as ErrorResponse;
			expect(err.code).toBe("UNKNOWN_ACTION");
			expect(err.message).toContain('"unknownAction"');
		});

		test("returns UNKNOWN_ACTION for empty string", async () => {
			const result = await dispatch("", {});
			expect(isErrorResponse(result)).toBe(true);
			const err = result as ErrorResponse;
			expect(err.code).toBe("UNKNOWN_ACTION");
		});

		test("suggests supported actions in error message", async () => {
			const result = await dispatch("invalid", {});
			const err = result as ErrorResponse;
			expect(err.suggestion).toBeDefined();
			expect(err.suggestion).toContain("navigate");
			expect(err.suggestion).toContain("click");
		});
	});

	describe("error responses are not thrown", () => {
		test("dispatcher never throws — returns error objects instead", async () => {
			let threw = false;
			try {
				await dispatch("click", null);
			} catch {
				threw = true;
			}
			expect(threw).toBe(false);
		});

		test("unknown action never throws", async () => {
			let threw = false;
			try {
				await dispatch("__nonexistent__", {});
			} catch {
				threw = true;
			}
			expect(threw).toBe(false);
		});
	});
});
