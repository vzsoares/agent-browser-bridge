/**
 * forwardToContentScript retry logic tests.
 *
 * Tests the retry loop in infrastructure/chrome-tabs.ts using mocked
 * Chrome APIs — no real Chrome extension calls.
 *
 * @module infrastructure/__tests__/chrome-tabs.test
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  forwardToContentScript,
  ensureContentScript,
  sendMessageToTab,
  removeInjected,
  markInjected,
  isInjected,
} from "../chrome-tabs.js";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Create a minimal valid request. */
function makeReq(id = "test-1", action = "click"): { id: string; action: string; params?: unknown } {
  return { id, action, params: { selector: "#btn" } };
}

/**
 * Install a mock for chrome.tabs.sendMessage that we control per test.
 * Returns the mock so tests can set behavior.
 */
function mockSendMessage() {
  const mock = vi.fn<(tabId: number, message: unknown) => Promise<unknown>>();
  // The infrastructure accesses chrome.tabs.sendMessage which is set up
  // by the global chrome mock from our test setup.
  // Here we replace it directly on the chrome global.
  const g = globalThis as Record<string, unknown>;
  const tabs = (g.chrome as Record<string, unknown>)?.tabs as Record<string, unknown> | undefined;
  if (tabs) {
    tabs.sendMessage = mock;
  } else {
    // Fallback: set up chrome.tabs.sendMessage directly
    g.chrome = g.chrome ?? {};
    (g.chrome as Record<string, unknown>).tabs = { sendMessage: mock };
  }
  return mock;
}

/** Reset the injectedTabs module state between tests. */
function resetInjectedState() {
  // Call removeInjected for all known tabs — we don't track them,
  // but we can clear state by re-importing. Instead, just call
  // the internal reset. Since injectedTabs is module-private,
  // the cleanest approach is to ensure each test starts fresh.
  // We use a trick: markInjected to add, then removeInjected to clean.
  // Actually, the state is module-scoped — we just need to be careful.
  // The isInjected/markInjected/removeInjected functions work on the
  // same set. Tests that care about state should manage it explicitly.
}

// ── Tests: success path ───────────────────────────────────────────────────

describe("forwardToContentScript — success path", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns content script response on first attempt", async () => {
    const sendMock = mockSendMessage();
    const expected = { id: "test-1", result: "ok" };

    // First call: ensureContentScript ping → resolves
    // Second call: the actual request → resolves with expected
    sendMock.mockResolvedValueOnce({}); // ping response
    sendMock.mockResolvedValueOnce(expected); // actual response

    const promise = forwardToContentScript(1, makeReq(), 2);

    // No sleeps needed if ensureContentScript succeeds immediately
    const result = await promise;

    expect(result).toEqual(expected);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  test("verifies content script before sending request", async () => {
    const sendMock = mockSendMessage();
    sendMock.mockResolvedValueOnce({}); // ping
    sendMock.mockResolvedValueOnce({ id: "test-1", result: "ok" });

    await forwardToContentScript(42, makeReq(), 2);

    // First call is the ping (ensureContentScript)
    expect(sendMock).toHaveBeenNthCalledWith(1, 42, { type: "ping" });
    // Second call is the actual request
    expect(sendMock).toHaveBeenNthCalledWith(2, 42, makeReq());
  });

  test("skips ping if tab is already injected", async () => {
    // Mark tab 99 as already injected
    markInjected(99);

    const sendMock = mockSendMessage();
    sendMock.mockResolvedValueOnce({ id: "test-1", result: "ok" });

    await forwardToContentScript(99, makeReq(), 2);

    // Only 1 call — no ping needed
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(99, makeReq());

    // Clean up
    removeInjected(99);
  });
});

// ── Tests: retry on ensureContentScript failure ───────────────────────────

describe("forwardToContentScript — retry on ensureContentScript failure", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    removeInjected(1); // Reset state
  });

  afterEach(() => {
    vi.useRealTimers();
    removeInjected(1);
  });

  test("retries and succeeds after ensureContentScript fails once", async () => {
    const sendMock = mockSendMessage();
    const expected = { id: "test-1", result: "ok" };

    // Attempt 0: ensureContentScript ping fails
    sendMock.mockRejectedValueOnce(new Error("Content script not available"));
    // Attempt 1: ensureContentScript ping succeeds, then request succeeds
    sendMock.mockResolvedValueOnce({}); // ping
    sendMock.mockResolvedValueOnce(expected); // request

    const promise = forwardToContentScript(1, makeReq(), 2);

    // Advance past the 300ms sleep between retries
    await vi.advanceTimersByTimeAsync(300);

    const result = await promise;

    expect(result).toEqual(expected);
    // ping fail + ping success + request success = 3 calls
    expect(sendMock).toHaveBeenCalledTimes(3);
  });

  test("returns BROWSER_NOT_CONNECTED when max retries exhausted on ensureContentScript", async () => {
    const sendMock = mockSendMessage();

    // All ensureContentScript pings fail
    sendMock.mockRejectedValue(new Error("Content script not available in tab 5"));

    const promise = forwardToContentScript(5, makeReq(), 2);

    // Advance past 2 retries × 300ms
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(300);

    const result = await promise;

    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("BROWSER_NOT_CONNECTED");
    expect(result.error!.message).toContain("Content script not available");
    // 3 calls total: initial + 2 retries
    expect(sendMock).toHaveBeenCalledTimes(3);
  });

  test("respects custom maxRetries=0 (no retries)", async () => {
    const sendMock = mockSendMessage();
    sendMock.mockRejectedValue(new Error("fail"));

    const result = await forwardToContentScript(1, makeReq(), 0);

    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("BROWSER_NOT_CONNECTED");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

// ── Tests: retry on sendMessage failure ───────────────────────────────────

describe("forwardToContentScript — retry on sendMessage failure", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    removeInjected(1);
  });

  afterEach(() => {
    vi.useRealTimers();
    removeInjected(1);
  });

  test("retries on connection reset error", async () => {
    const sendMock = mockSendMessage();
    const expected = { id: "test-1", result: "ok" };

    // Attempt 0: ping succeeds, request fails with transient error
    sendMock.mockResolvedValueOnce({}); // ping
    sendMock.mockRejectedValueOnce(new Error("Could not establish connection"));
    // Attempt 1: ping succeeds, request succeeds
    sendMock.mockResolvedValueOnce({}); // ping
    sendMock.mockResolvedValueOnce(expected); // request

    const promise = forwardToContentScript(1, makeReq(), 2);
    await vi.advanceTimersByTimeAsync(300);

    const result = await promise;

    expect(result).toEqual(expected);
    expect(sendMock).toHaveBeenCalledTimes(4); // ping + req + ping + req
  });

  test("retries on 'port' error (without 'closed' in message)", async () => {
    const sendMock = mockSendMessage();
    const expected = { id: "test-1", result: "ok" };

    // "port disconnected" matches "port" but NOT "closed"
    sendMock.mockResolvedValueOnce({}); // ping
    sendMock.mockRejectedValueOnce(new Error("Message port disconnected"));
    sendMock.mockResolvedValueOnce({}); // ping
    sendMock.mockResolvedValueOnce(expected);

    const promise = forwardToContentScript(1, makeReq(), 2);
    await vi.advanceTimersByTimeAsync(300);

    const result = await promise;

    expect(result).toEqual(expected);
    expect(sendMock).toHaveBeenCalledTimes(4);
  });

  test("retries on timeout error", async () => {
    const sendMock = mockSendMessage();
    const expected = { id: "test-1", result: "ok" };

    sendMock.mockResolvedValueOnce({}); // ping
    sendMock.mockRejectedValueOnce(new Error("Content script request timed out"));
    sendMock.mockResolvedValueOnce({}); // ping
    sendMock.mockResolvedValueOnce(expected);

    const promise = forwardToContentScript(1, makeReq(), 2);
    await vi.advanceTimersByTimeAsync(300);

    const result = await promise;

    expect(result).toEqual(expected);
    expect(sendMock).toHaveBeenCalledTimes(4);
  });
});

// ── Tests: no retry on terminal errors ────────────────────────────────────

describe("forwardToContentScript — no retry on terminal errors", () => {
  beforeEach(() => {
    removeInjected(1);
  });

  afterEach(() => {
    removeInjected(1);
  });

  test("does not retry when tab is closed", async () => {
    markInjected(5); // Tab was previously verified
    const sendMock = mockSendMessage();

    // ensureContentScript skips (already injected), request fails
    sendMock.mockRejectedValueOnce(new Error("Receiving end does not exist"));

    const result = await forwardToContentScript(5, makeReq(), 2);

    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("BROWSER_NOT_CONNECTED");
    expect(result.error!.message).toContain("Tab 5 was closed");
    expect(sendMock).toHaveBeenCalledTimes(1); // No retry
    expect(isInjected(5)).toBe(false); // Cleaned up
  });

  test("does not retry when message contains 'closed'", async () => {
    markInjected(3);
    const sendMock = mockSendMessage();

    // "port closed" contains "closed" → terminal, no retry
    sendMock.mockRejectedValueOnce(new Error("Error: port closed"));

    const result = await forwardToContentScript(3, makeReq(), 2);

    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("BROWSER_NOT_CONNECTED");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  test("returns UNKNOWN_ACTION for non-retriable errors", async () => {
    markInjected(1);
    const sendMock = mockSendMessage();
    sendMock.mockRejectedValueOnce(new Error("Some unexpected error"));

    const result = await forwardToContentScript(1, makeReq(), 2);

    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("UNKNOWN_ACTION");
    expect(result.error!.message).toBe("Some unexpected error");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

// ── Tests: maxRetries parameter ───────────────────────────────────────────

describe("forwardToContentScript — maxRetries parameter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    removeInjected(1);
  });

  afterEach(() => {
    vi.useRealTimers();
    removeInjected(1);
  });

  test("maxRetries=1 allows exactly one retry", async () => {
    const sendMock = mockSendMessage();
    sendMock.mockRejectedValue(new Error("persistent failure"));

    const promise = forwardToContentScript(1, makeReq(), 1);
    await vi.advanceTimersByTimeAsync(300);

    const result = await promise;

    // initial + 1 retry = 2 calls
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(result.error).toBeDefined();
  });

  test("maxRetries=5 allows up to 5 retries", async () => {
    const sendMock = mockSendMessage();
    sendMock.mockRejectedValue(new Error("persistent failure"));

    const promise = forwardToContentScript(1, makeReq(), 5);

    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(300);
    }

    const result = await promise;

    // initial + 5 retries = 6 calls
    expect(sendMock).toHaveBeenCalledTimes(6);
    expect(result.error).toBeDefined();
  });
});

// ── Tests: invalid response shape ─────────────────────────────────────────

describe("forwardToContentScript — invalid response shape", () => {
  beforeEach(() => {
    markInjected(1);
  });

  afterEach(() => {
    removeInjected(1);
  });

  test("returns UNKNOWN_ACTION when response lacks 'id' field", async () => {
    const sendMock = mockSendMessage();
    sendMock.mockResolvedValueOnce({ result: "no id field" });

    const result = await forwardToContentScript(1, makeReq(), 2);

    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("UNKNOWN_ACTION");
    expect(result.error!.message).toContain("Invalid response");
  });

  test("returns UNKNOWN_ACTION when response is null", async () => {
    const sendMock = mockSendMessage();
    sendMock.mockResolvedValueOnce(null);

    const result = await forwardToContentScript(1, makeReq(), 2);

    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("UNKNOWN_ACTION");
  });

  test("returns UNKNOWN_ACTION when response is a string", async () => {
    const sendMock = mockSendMessage();
    sendMock.mockResolvedValueOnce("just a string");

    const result = await forwardToContentScript(1, makeReq(), 2);

    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("UNKNOWN_ACTION");
  });
});

// ── Tests: injectedTabs management ────────────────────────────────────────

describe("forwardToContentScript — injectedTabs management", () => {
  test("removes tab from injected on tab-closed error", async () => {
    markInjected(10);
    const sendMock = mockSendMessage();
    sendMock.mockRejectedValueOnce(new Error("Receiving end does not exist"));

    await forwardToContentScript(10, makeReq(), 2);

    expect(isInjected(10)).toBe(false);
  });

  test("removes tab from injected on retriable failure, re-marks on successful retry", async () => {
    vi.useFakeTimers();
    markInjected(15);
    const sendMock = mockSendMessage();

    sendMock.mockRejectedValueOnce(new Error("Could not establish connection"));
    // On retry, ensureContentScript re-verifies and re-marks injected
    sendMock.mockResolvedValueOnce({}); // ping succeeds
    sendMock.mockResolvedValueOnce({ id: "test-1", result: "ok" }); // request succeeds

    const promise = forwardToContentScript(15, makeReq(), 2);
    await vi.advanceTimersByTimeAsync(300);

    await promise;
    vi.useRealTimers();

    // After retry, ensureContentScript re-marks tab as injected
    expect(isInjected(15)).toBe(true);
    removeInjected(15);
  });
});

// ── Tests: edge cases ─────────────────────────────────────────────────────

describe("forwardToContentScript — edge cases", () => {
  test("handles ensureContentScript failing (wraps error in its own message)", async () => {
    vi.useFakeTimers();
    removeInjected(1);

    const sendMock = mockSendMessage();
    // ensureContentScript wraps ALL errors into its own Error message
    sendMock.mockRejectedValue("string error");

    const promise = forwardToContentScript(1, makeReq(), 2);

    for (let i = 0; i < 2; i++) {
      await vi.advanceTimersByTimeAsync(300);
    }

    const result = await promise;
    vi.useRealTimers();

    expect(result.error).toBeDefined();
    // ensureContentScript always wraps with "Content script not available..."
    expect(result.error!.message).toContain("Content script not available");
    removeInjected(1);
  });

  test("handles sendMessage rejecting with non-Error", async () => {
    markInjected(1);
    const sendMock = mockSendMessage();
    sendMock.mockRejectedValue(42);

    const result = await forwardToContentScript(1, makeReq(), 2);

    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("UNKNOWN_ACTION");
    expect(result.error!.message).toBe("42");
    removeInjected(1);
  });

  test("uses the request id in error responses", async () => {
    removeInjected(1);

    const sendMock = mockSendMessage();
    sendMock.mockRejectedValue(new Error("fail"));

    const result = await forwardToContentScript(1, makeReq("custom-id-123"), 0);

    expect(result.id).toBe("custom-id-123");
    expect(result.error).toBeDefined();
  });

  test("default maxRetries is 2", async () => {
    vi.useFakeTimers();
    removeInjected(1);

    const sendMock = mockSendMessage();
    sendMock.mockRejectedValue(new Error("fail"));

    const promise = forwardToContentScript(1, makeReq());

    for (let i = 0; i < 2; i++) {
      await vi.advanceTimersByTimeAsync(300);
    }

    const result = await promise;
    vi.useRealTimers();

    // 3 calls: initial + default 2 retries
    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(result.error).toBeDefined();
    removeInjected(1);
  });
});
