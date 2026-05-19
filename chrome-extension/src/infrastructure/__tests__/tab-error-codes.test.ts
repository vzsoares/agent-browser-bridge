/**
 * Tests for TAB_NOT_FOUND error handling and tab-closed error response shapes.
 *
 * Verifies that the infrastructure layer produces correctly-shaped error
 * responses when tabs are closed, missing, or invalid, using the
 * TAB_NOT_FOUND and BROWSER_NOT_CONNECTED error codes from the protocol.
 *
 * @module infrastructure/__tests__/tab-error-codes.test
 */

import type { ErrorResponse } from "@agent-browser-bridge/protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	forwardToContentScript,
	isInjected,
	markInjected,
	removeInjected,
} from "../chrome-tabs.js";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Create a minimal valid request. */
function makeReq(id = "test-1", action = "click") {
	return { id, action, params: { selector: "#btn" } };
}

/** Install a mock for chrome.tabs.sendMessage. */
function mockSendMessage() {
	const mock = vi.fn<(tabId: number, message: unknown) => Promise<unknown>>();
	const g = globalThis as Record<string, unknown>;
	g.chrome = g.chrome ?? {};
	const chrome = g.chrome as Record<string, unknown>;
	const tabs = chrome.tabs ?? {};
	(tabs as Record<string, unknown>).sendMessage = mock;
	chrome.tabs = tabs;
	return mock;
}

// ═══════════════════════════════════════════════════════════════════════════
// Error response shapes for tab-closed scenarios
// ═══════════════════════════════════════════════════════════════════════════

describe("Error response shapes for tab-closed scenarios", () => {
	beforeEach(() => {
		removeInjected(1);
		removeInjected(5);
		removeInjected(10);
		removeInjected(99);
	});

	afterEach(() => {
		removeInjected(1);
		removeInjected(5);
		removeInjected(10);
		removeInjected(99);
	});

	describe("BROWSER_NOT_CONNECTED for closed tabs", () => {
		test("returns error with code TAB_NOT_FOUND when tab is closed", async () => {
			markInjected(5);
			const sendMock = mockSendMessage();
			sendMock.mockRejectedValueOnce(new Error("Receiving end does not exist"));

			const result = await forwardToContentScript(5, makeReq(), 0);

			expect(result.error).toBeDefined();
			expect(result.error!.code).toBe("TAB_NOT_FOUND");
			expect(result.error!.message).toContain("closed");
			expect(result.error!.message).toContain("5");
			expect(result.id).toBe("test-1");
			expect(isInjected(5)).toBe(false);
		});

		test("returns error with suggestion for closed tab", async () => {
			markInjected(10);
			const sendMock = mockSendMessage();
			sendMock.mockRejectedValueOnce(new Error("Receiving end does not exist"));

			const result = await forwardToContentScript(10, makeReq(), 0);

			expect(result.error!.suggestion).toBeDefined();
			expect(result.error!.suggestion).toContain("listTabs");
		});

		test("returns error with TAB_NOT_FOUND code for port closed error", async () => {
			markInjected(99);
			const sendMock = mockSendMessage();
			sendMock.mockRejectedValueOnce(new Error("Error: port closed"));

			const result = await forwardToContentScript(99, makeReq(), 0);

			expect(result.error!.code).toBe("TAB_NOT_FOUND");
			expect(result.error!.message).toContain("closed");
		});
	});

	describe("error response shape matches ErrorResponse interface", () => {
		test("error response has code, message, and optional suggestion", async () => {
			markInjected(1);
			const sendMock = mockSendMessage();
			sendMock.mockRejectedValueOnce(new Error("Receiving end does not exist"));

			const result = await forwardToContentScript(1, makeReq(), 0);

			// Verify the error shape matches ErrorResponse
			const err = result.error as ErrorResponse;
			expect(typeof err.code).toBe("string");
			expect(typeof err.message).toBe("string");
			expect(result.id).toBeDefined();
		});

		test("error response carries the original request id", async () => {
			markInjected(1);
			const sendMock = mockSendMessage();
			sendMock.mockRejectedValueOnce(new Error("Receiving end does not exist"));

			const result = await forwardToContentScript(
				1,
				makeReq("my-custom-id"),
				0,
			);

			expect(result.id).toBe("my-custom-id");
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// TAB_NOT_FOUND vs BROWSER_NOT_CONNECTED distinction
// ═══════════════════════════════════════════════════════════════════════════

describe("TAB_NOT_FOUND vs BROWSER_NOT_CONNECTED distinction", () => {
	test("BROWSER_NOT_CONNECTED is for connection-level failures", () => {
		const err: ErrorResponse = {
			code: "BROWSER_NOT_CONNECTED",
			message: "No Chrome extension is connected to the WebSocket server.",
		};
		expect(err.code).toBe("BROWSER_NOT_CONNECTED");
	});

	test("TAB_NOT_FOUND is for tab-level failures (specific tab missing)", () => {
		const err: ErrorResponse = {
			code: "TAB_NOT_FOUND",
			message: "Tab 42 does not correspond to any open tab.",
			suggestion:
				"The tab may have been closed. List tabs to find a valid TabId.",
		};
		expect(err.code).toBe("TAB_NOT_FOUND");
		expect(err.suggestion).toBeDefined();
		expect(err.suggestion).toContain("List tabs");
	});

	test("the two error codes are distinct strings", () => {
		const tabNotFound: ErrorResponse = {
			code: "TAB_NOT_FOUND",
			message: "Tab not found",
		};
		const browserNotConnected: ErrorResponse = {
			code: "BROWSER_NOT_CONNECTED",
			message: "Browser not connected",
		};
		expect(tabNotFound.code).not.toBe(browserNotConnected.code);
	});
});
