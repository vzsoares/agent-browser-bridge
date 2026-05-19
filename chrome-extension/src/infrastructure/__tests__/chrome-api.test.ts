/**
 * Chrome API wrapper tests — chrome.runtime, chrome.tabs, chrome.storage.
 *
 * Uses the typed mocks from T004 to simulate Chrome API calls without
 * a real browser extension context. All tests are deterministic.
 *
 * @module infrastructure/__tests__/chrome-api.test
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	chromeRuntimeMock,
	chromeStorageMock,
	chromeTabsMock,
	installAllChromeMocks,
} from "../../__tests__/mocks/index.js";
import {
	onInstalled,
	onRuntimeMessage,
	onStorageKeyChanged,
	onTabActivated,
	onTabRemoved,
	setStatusBadge,
} from "../chrome-runtime.js";

import {
	ALLOWLIST_KEY,
	DEFAULT_ALLOWLIST,
	DEFAULT_PORT,
	getAllowlist,
	getBridgeConfig,
	initializeAllowlist,
	loadPort,
	STORAGE_KEY,
	saveAllowlist,
	saveBridgeConfig,
	savePort,
} from "../chrome-storage.js";
import {
	captureVisibleTab,
	ensureContentScript,
	executeScriptInTab,
	forwardToContentScript,
	getActiveTabId,
	getActiveTabUrl,
	getTab,
	isInjected,
	isRestrictedUrl,
	markInjected,
	removeInjected,
	sendMessageToTab,
	updateTab,
	waitForTabComplete,
} from "../chrome-tabs.js";

// ── Setup / teardown ─────────────────────────────────────────────────────

beforeEach(() => {
	installAllChromeMocks();
	chromeTabsMock.reset();
	chromeStorageMock.reset();
	chromeRuntimeMock.reset();

	// Also need to mock chrome.action, chrome.storage.onChanged, and
	// chrome.runtime.onInstalled, chrome.tabs.onActivated, chrome.tabs.onRemoved,
	// chrome.scripting.executeScript, chrome.tabs.onUpdated
	const g = globalThis as Record<string, unknown>;
	g.chrome = g.chrome ?? {};

	// chrome.action
	(g.chrome as Record<string, unknown>).action = {
		setBadgeText: vi.fn().mockResolvedValue(undefined),
		setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
		setTitle: vi.fn().mockResolvedValue(undefined),
	};

	// chrome.tabs.onActivated
	(g.chrome as Record<string, unknown>).tabs = {
		// @ts-expect-error spread on Record<string, unknown>
		...(g.chrome as Record<string, unknown>).tabs,
		onActivated: {
			addListener: vi.fn(),
			removeListener: vi.fn(),
		},
		onRemoved: {
			addListener: vi.fn(),
			removeListener: vi.fn(),
		},
		onUpdated: {
			addListener: vi.fn(),
			removeListener: vi.fn(),
		},
		get: vi.fn().mockResolvedValue(null),
		update: vi.fn().mockResolvedValue({}),
	};

	// chrome.storage.onChanged
	(g.chrome as Record<string, unknown>).storage = {
		// @ts-expect-error spread on Record<string, unknown>
		...(g.chrome as Record<string, unknown>).storage,
		onChanged: {
			addListener: vi.fn(),
			removeListener: vi.fn(),
		},
	};

	// chrome.runtime.onInstalled
	(g.chrome as Record<string, unknown>).runtime = {
		// @ts-expect-error spread on Record<string, unknown>
		...(g.chrome as Record<string, unknown>).runtime,
		onInstalled: {
			addListener: vi.fn(),
			removeListener: vi.fn(),
		},
	};

	// chrome.scripting.executeScript
	(g.chrome as Record<string, unknown>).scripting = {
		executeScript: vi.fn().mockResolvedValue([]),
	};
});

afterEach(() => {
	vi.clearAllMocks();
});

// ── chrome-runtime tests ─────────────────────────────────────────────────

describe("chrome-runtime — setStatusBadge", () => {
	test("sets badge text, color, and title for 'connected' status", async () => {
		await setStatusBadge("connected");

		const action = (globalThis as any).chrome.action;
		expect(action.setBadgeText).toHaveBeenCalledWith({ text: "ON" });
		expect(action.setBadgeBackgroundColor).toHaveBeenCalledWith({
			color: "#22c55e",
		});
		expect(action.setTitle).toHaveBeenCalledWith({
			title: "Agent Browser Bridge — Connected",
		});
	});

	test("sets badge text, color, and title for 'disconnected' status", async () => {
		await setStatusBadge("disconnected");

		const action = (globalThis as any).chrome.action;
		expect(action.setBadgeText).toHaveBeenCalledWith({ text: "OFF" });
		expect(action.setBadgeBackgroundColor).toHaveBeenCalledWith({
			color: "#ef4444",
		});
		expect(action.setTitle).toHaveBeenCalledWith({
			title: "Agent Browser Bridge — Disconnected",
		});
	});

	test("sets badge text, color, and title for 'connecting' status", async () => {
		await setStatusBadge("connecting");

		const action = (globalThis as any).chrome.action;
		expect(action.setBadgeText).toHaveBeenCalledWith({ text: "···" });
		expect(action.setBadgeBackgroundColor).toHaveBeenCalledWith({
			color: "#eab308",
		});
		expect(action.setTitle).toHaveBeenCalledWith({
			title: "Agent Browser Bridge — Connecting…",
		});
	});

	test("handles chrome.action errors gracefully", async () => {
		const action = (globalThis as any).chrome.action;
		action.setBadgeText.mockRejectedValue(new Error("No action"));

		// Should not throw
		await expect(setStatusBadge("connected")).resolves.toBeUndefined();
	});
});

describe("chrome-runtime — onTabActivated", () => {
	test("registers a listener and returns a cleanup function", () => {
		const callback = vi.fn();
		const cleanup = onTabActivated(callback);

		const tabs = (globalThis as any).chrome.tabs;
		expect(tabs.onActivated.addListener).toHaveBeenCalledTimes(1);

		// Call cleanup
		cleanup();
		expect(tabs.onActivated.removeListener).toHaveBeenCalledTimes(1);
	});

	test("fires callback when tab is activated", () => {
		const tabs = (globalThis as any).chrome.tabs;
		let capturedListener: ((info: { tabId: number }) => void) | null = null;

		tabs.onActivated.addListener.mockImplementation(
			(listener: (info: { tabId: number }) => void) => {
				capturedListener = listener;
			},
		);

		const callback = vi.fn();
		onTabActivated(callback);

		// Simulate tab activation
		if (capturedListener)
			(capturedListener as Function)({ tabId: 42, windowId: 1 });
		expect(callback).toHaveBeenCalledWith(42);
	});
});

describe("chrome-runtime — onTabRemoved", () => {
	test("registers a listener and returns a cleanup function", () => {
		const callback = vi.fn();
		const cleanup = onTabRemoved(callback);

		const tabs = (globalThis as any).chrome.tabs;
		expect(tabs.onRemoved.addListener).toHaveBeenCalledTimes(1);

		cleanup();
		expect(tabs.onRemoved.removeListener).toHaveBeenCalledTimes(1);
	});

	test("fires callback when tab is removed", () => {
		const tabs = (globalThis as any).chrome.tabs;
		let capturedListener: ((tabId: number) => void) | undefined;

		tabs.onRemoved.addListener.mockImplementation(
			(listener: (tabId: number) => void) => {
				capturedListener = listener;
			},
		);

		const callback = vi.fn();
		onTabRemoved(callback);

		if (capturedListener) (capturedListener as Function)(42);
		expect(callback).toHaveBeenCalledWith(42);
	});
});

describe("chrome-runtime — onStorageKeyChanged", () => {
	test("registers a listener and returns a cleanup function", () => {
		const callback = vi.fn();
		const cleanup = onStorageKeyChanged("myKey", callback);

		const storage = (globalThis as any).chrome.storage;
		expect(storage.onChanged.addListener).toHaveBeenCalledTimes(1);

		cleanup();
		expect(storage.onChanged.removeListener).toHaveBeenCalledTimes(1);
	});

	test("fires callback when matching key changes", () => {
		const storage = (globalThis as any).chrome.storage;
		let capturedListener:
			| ((changes: Record<string, any>, areaName: string) => void)
			| null = null;

		storage.onChanged.addListener.mockImplementation(
			(listener: (changes: Record<string, any>, areaName: string) => void) => {
				capturedListener = listener;
			},
		);

		const callback = vi.fn();
		onStorageKeyChanged("testKey", callback);

		// Simulate a storage change on the matching key
		if (capturedListener)
			(capturedListener as Function)(
				{
					testKey: { newValue: "new", oldValue: "old" },
					otherKey: { newValue: "ignored" },
				},
				"local",
			);

		expect(callback).toHaveBeenCalledWith("new", "old");
	});

	test("does NOT fire callback for non-local storage area", () => {
		const storage = (globalThis as any).chrome.storage;
		let capturedListener:
			| ((changes: Record<string, any>, areaName: string) => void)
			| null = null;

		storage.onChanged.addListener.mockImplementation(
			(listener: (changes: Record<string, any>, areaName: string) => void) => {
				capturedListener = listener;
			},
		);

		const callback = vi.fn();
		onStorageKeyChanged("testKey", callback);

		// Simulate a change in "sync" area (not "local")
		if (capturedListener)
			(capturedListener as Function)({ testKey: { newValue: "new" } }, "sync");

		expect(callback).not.toHaveBeenCalled();
	});

	test("does NOT fire when the key is not in the changes", () => {
		const storage = (globalThis as any).chrome.storage;
		let capturedListener:
			| ((changes: Record<string, any>, areaName: string) => void)
			| null = null;

		storage.onChanged.addListener.mockImplementation(
			(listener: (changes: Record<string, any>, areaName: string) => void) => {
				capturedListener = listener;
			},
		);

		const callback = vi.fn();
		onStorageKeyChanged("testKey", callback);

		// Simulate a change on a different key
		if (capturedListener)
			(capturedListener as Function)(
				{ otherKey: { newValue: "data" } },
				"local",
			);

		expect(callback).not.toHaveBeenCalled();
	});
});

describe("chrome-runtime — onInstalled", () => {
	test("registers a listener and returns a cleanup function", () => {
		const callback = vi.fn();
		const cleanup = onInstalled(callback);

		const runtime = (globalThis as any).chrome.runtime;
		expect(runtime.onInstalled.addListener).toHaveBeenCalledTimes(1);

		cleanup();
		expect(runtime.onInstalled.removeListener).toHaveBeenCalledTimes(1);
	});
});

describe("chrome-runtime — onRuntimeMessage", () => {
	test("registers a listener and returns a cleanup function", () => {
		const callback = vi.fn();
		const cleanup = onRuntimeMessage(callback);

		// Should call chrome.runtime.onMessage.addListener (our mock)
		expect(chromeRuntimeMock.addListener).toHaveBeenCalledTimes(1);

		cleanup();
		expect(chromeRuntimeMock.removeListener).toHaveBeenCalledTimes(1);
	});
});

// ── chrome-tabs tests ────────────────────────────────────────────────────

describe("chrome-tabs — getActiveTabId", () => {
	test("returns tab ID when an active tab exists", async () => {
		chromeTabsMock.setTabs([
			{ id: 5, url: "https://example.com", active: true },
		]);

		const tabId = await getActiveTabId();
		expect(tabId).toBe(5);
	});

	test("returns null when no active tab exists", async () => {
		chromeTabsMock.setTabs([]);

		const tabId = await getActiveTabId();
		expect(tabId).toBeNull();
	});

	test("returns null when query throws", async () => {
		chromeTabsMock.query.mockRejectedValueOnce(new Error("rejected"));

		const tabId = await getActiveTabId();
		expect(tabId).toBeNull();
	});
});

describe("chrome-tabs — getActiveTabUrl", () => {
	test("returns URL when active tab exists", async () => {
		chromeTabsMock.setTabs([
			{ id: 1, url: "https://example.com/page", active: true },
		]);

		const url = await getActiveTabUrl();
		expect(url).toBe("https://example.com/page");
	});

	test("returns null when no active tab", async () => {
		chromeTabsMock.setTabs([]);

		const url = await getActiveTabUrl();
		expect(url).toBeNull();
	});

	test("returns null on error", async () => {
		chromeTabsMock.query.mockRejectedValueOnce(new Error("fail"));

		const url = await getActiveTabUrl();
		expect(url).toBeNull();
	});
});

describe("chrome-tabs — getTab", () => {
	test("returns tab descriptor when tab exists", async () => {
		const mockTab = {
			id: 1,
			index: 0,
			windowId: 1,
			url: "https://example.com",
			title: "Example",
			active: true,
			pinned: false,
			status: "complete",
		} as chrome.tabs.Tab;
		(globalThis as any).chrome.tabs.get.mockResolvedValue(mockTab);

		const result = await getTab(1);
		expect(result).toEqual(mockTab);
	});

	test("returns null when tab doesn't exist", async () => {
		(globalThis as any).chrome.tabs.get.mockRejectedValue(
			new Error("Tab not found"),
		);

		const result = await getTab(999);
		expect(result).toBeNull();
	});
});

describe("chrome-tabs — updateTab", () => {
	test("navigates tab to given URL", async () => {
		const mockTab = {
			id: 1,
			index: 0,
			windowId: 1,
			url: "https://new-url.com",
		} as chrome.tabs.Tab;
		(globalThis as any).chrome.tabs.update.mockResolvedValue(mockTab);

		const result = await updateTab(1, "https://new-url.com");
		expect((globalThis as any).chrome.tabs.update).toHaveBeenCalledWith(1, {
			url: "https://new-url.com",
		});
		expect(result).toBe(mockTab);
	});
});

describe("chrome-tabs — captureVisibleTab", () => {
	test("calls chrome.tabs.captureVisibleTab with correct options", async () => {
		const dataUrl = "data:image/png;base64,abc123";
		chromeTabsMock.captureVisibleTab.mockResolvedValue(dataUrl);

		const result = await captureVisibleTab("png");
		expect(result).toBe(dataUrl);
	});

	test("passes quality option for jpeg", async () => {
		chromeTabsMock.captureVisibleTab.mockResolvedValue(
			"data:image/jpeg;base64,...",
		);

		await captureVisibleTab("jpeg", 80);
		expect(chromeTabsMock.captureVisibleTab).toHaveBeenCalledWith({
			format: "jpeg",
			quality: 80,
		});
	});

	test("omits quality for png", async () => {
		chromeTabsMock.captureVisibleTab.mockResolvedValue(
			"data:image/png;base64,...",
		);

		await captureVisibleTab("png");
		expect(chromeTabsMock.captureVisibleTab).toHaveBeenCalledWith({
			format: "png",
		});
	});

	test("works with default format (no arguments)", async () => {
		chromeTabsMock.captureVisibleTab.mockResolvedValue(
			"data:image/png;base64,...",
		);

		await captureVisibleTab();
		expect(chromeTabsMock.captureVisibleTab).toHaveBeenCalledWith({});
	});
});

describe("chrome-tabs — executeScriptInTab", () => {
	test("calls chrome.scripting.executeScript with correct target", async () => {
		const scripting = (globalThis as any).chrome.scripting;
		const mockResult = [
			{ frameId: 0, result: "hello" },
		] as chrome.scripting.InjectionResult<string>[];
		scripting.executeScript.mockResolvedValue(mockResult);

		const result = await executeScriptInTab(1, () => "hello");
		expect(scripting.executeScript).toHaveBeenCalledWith({
			target: { tabId: 1 },
			func: expect.any(Function),
		});
		expect(result).toEqual(mockResult);
	});
});

describe("chrome-tabs — sendMessageToTab", () => {
	test("sends message and returns response", async () => {
		chromeTabsMock.sendMessage.mockResolvedValue({ success: true });

		const result = await sendMessageToTab(1, { type: "ping" }, 5000);
		expect(result).toEqual({ success: true });
		expect(chromeTabsMock.sendMessage).toHaveBeenCalledWith(1, {
			type: "ping",
		});
	});

	test("times out after specified duration", async () => {
		// Make sendMessage hang forever
		chromeTabsMock.sendMessage.mockImplementation(
			() => new Promise(() => {}), // never resolves
		);

		vi.useFakeTimers();
		const promise = sendMessageToTab(1, { type: "test" }, 1000);
		vi.advanceTimersByTime(1100);

		await expect(promise).rejects.toThrow("Content script request timed out");
		vi.useRealTimers();
	});
});

describe("chrome-tabs — ensureContentScript", () => {
	test("skips when already injected", async () => {
		markInjected(1);
		chromeTabsMock.sendMessage.mockRejectedValue(
			new Error("Should not be called"),
		);

		await ensureContentScript(1);
		// Should not have called sendMessage
		expect(chromeTabsMock.sendMessage).not.toHaveBeenCalled();
		removeInjected(1);
	});

	test("marks as injected on successful ping", async () => {
		chromeTabsMock.sendMessage.mockResolvedValue({ type: "pong" });

		await ensureContentScript(2);
		expect(isInjected(2)).toBe(true);
		removeInjected(2);
	});

	test("removes injection mark and throws on failure", async () => {
		chromeTabsMock.sendMessage.mockRejectedValue(
			new Error("No content script"),
		);

		await expect(ensureContentScript(3)).rejects.toThrow(
			"Content script not available in tab 3",
		);
		expect(isInjected(3)).toBe(false);
	});
});

describe("chrome-tabs — markInjected / isInjected / removeInjected", () => {
	test("tracks injection state correctly", () => {
		expect(isInjected(1)).toBe(false);

		markInjected(1);
		expect(isInjected(1)).toBe(true);

		removeInjected(1);
		expect(isInjected(1)).toBe(false);
	});

	test("removeInjected is idempotent", () => {
		removeInjected(999); // Should not throw
	});
});

describe("chrome-tabs — forwardToContentScript", () => {
	test("forwards request and returns response from content script", async () => {
		markInjected(1);
		chromeTabsMock.sendMessage.mockResolvedValue({
			id: "req-1",
			result: { text: "page content" },
		});

		const result = await forwardToContentScript(1, {
			id: "req-1",
			action: "read",
		});

		expect(result).toEqual({
			id: "req-1",
			result: { tabId: 1, text: "page content" },
		});
		removeInjected(1);
	});

	test("retries on connection error", async () => {
		// First call: ensureContentScript fails → triggers retry
		// The mock for ensureContentScript won't have markInjected set,
		// so sendMessage will be called for the ping.
		// Then sendMessage for the actual request also fails on first attempt.

		let callCount = 0;
		chromeTabsMock.sendMessage.mockImplementation(
			(_tabId: number, message: unknown) => {
				callCount++;
				const msg = message as Record<string, unknown>;

				// First call: ping (from ensureContentScript)
				if (msg.type === "ping") {
					return Promise.resolve({ type: "pong" });
				}

				// Request messages: fail first two attempts, succeed third
				if (callCount <= 3) {
					return Promise.reject(new Error("Could not establish connection"));
				}

				return Promise.resolve({ id: "req-1", result: { tabId: 1 } });
			},
		);

		vi.useFakeTimers();
		const promise = forwardToContentScript(1, { id: "req-1", action: "read" });

		// ensureContentScript succeeds (ping), then first sendMessage fails.
		// After 300ms sleep, retried. Let it resolve.
		// We need to advance past the sleeps
		await vi.advanceTimersByTimeAsync(350); // First retry sleep
		await vi.advanceTimersByTimeAsync(350); // Second retry sleep

		const result = await promise;
		vi.useRealTimers();

		expect(result).toEqual({ id: "req-1", result: { tabId: 1 } });
	}, 10000); // 10s timeout for async test

	test("returns error when tab closed (receiving end does not exist)", async () => {
		markInjected(1);
		chromeTabsMock.sendMessage.mockRejectedValue(
			new Error("Receiving end does not exist"),
		);

		const result = await forwardToContentScript(1, {
			id: "req-1",
			action: "read",
		});

		expect(result.error).toBeDefined();
		expect(result.error?.code).toBe("TAB_NOT_FOUND");
		expect(result.error?.message).toContain("closed");
		removeInjected(1);
	});

	test("returns error after exhausting all retries", async () => {
		chromeTabsMock.sendMessage.mockRejectedValue(
			new Error("Could not establish connection"),
		);

		vi.useFakeTimers();

		// Attempt 0: ensureContentScript ping fails → sleep(300) → retry
		// Attempt 1: ensuresContentScript ping fails → sleep(300) → retry
		// Attempt 2: (maxRetries=2) ensureContentScript ping fails → return error
		const promise = forwardToContentScript(
			1,
			{ id: "req-1", action: "read" },
			2,
		);

		// Advance past three sleep cycles (attempt 0, 1, 2)
		await vi.advanceTimersByTimeAsync(350);
		await vi.advanceTimersByTimeAsync(350);
		await vi.advanceTimersByTimeAsync(350);

		const result = await promise;
		vi.useRealTimers();

		expect(result.error).toBeDefined();
		expect(result.error?.code).toBe("BROWSER_NOT_CONNECTED");
	});
});

describe("chrome-tabs — isRestrictedUrl", () => {
	test("returns true for chrome:// URLs", () => {
		expect(isRestrictedUrl("chrome://extensions")).toBe(true);
		expect(isRestrictedUrl("chrome-extension://abc123/popup.html")).toBe(true);
	});

	test("returns true for about:// URLs", () => {
		expect(isRestrictedUrl("about://blank")).toBe(true);
	});

	test("returns true for edge:// URLs", () => {
		expect(isRestrictedUrl("edge://settings")).toBe(true);
	});

	test("returns true for brave:// URLs", () => {
		expect(isRestrictedUrl("brave://downloads")).toBe(true);
	});

	test("returns false for https:// URLs", () => {
		expect(isRestrictedUrl("https://example.com")).toBe(false);
	});

	test("returns false for http:// URLs", () => {
		expect(isRestrictedUrl("http://localhost:3000")).toBe(false);
	});

	test("returns false for file:// URLs", () => {
		// file:// is not in the restricted regex
		expect(isRestrictedUrl("file:///Users/test.html")).toBe(false);
	});
});

describe("chrome-tabs — waitForTabComplete", () => {
	test("resolves when tab status becomes 'complete'", async () => {
		const tabs = (globalThis as any).chrome.tabs;
		let capturedListener: ((tabId: number, info: any) => void) | null = null;

		tabs.onUpdated.addListener.mockImplementation(
			(listener: (tabId: number, info: any) => void) => {
				capturedListener = listener;
			},
		);

		vi.useFakeTimers();
		const promise = waitForTabComplete(5, 5000);

		// Simulate tab completing
		if (capturedListener)
			(capturedListener as Function)(5, { status: "complete" });

		await expect(promise).resolves.toBeUndefined();
		vi.useRealTimers();
		expect(tabs.onUpdated.removeListener).toHaveBeenCalled();
	});

	test("rejects when timeout expires", async () => {
		vi.useFakeTimers();
		const promise = waitForTabComplete(5, 1000);

		vi.advanceTimersByTime(1100);

		await expect(promise).rejects.toThrow("did not finish loading");
		vi.useRealTimers();
	});
});

// ── chrome-storage tests ─────────────────────────────────────────────────

describe("chrome-storage — getBridgeConfig", () => {
	test("returns defaults when storage is empty", async () => {
		chromeStorageMock.reset();

		const config = await getBridgeConfig();
		expect(config.port).toBe(DEFAULT_PORT); // 9242
		expect(config.enabled).toBe(true);
	});

	test("returns stored configuration when present", async () => {
		chromeStorageMock.setStore({
			[STORAGE_KEY]: {
				port: 8888,
				enabled: false,
				connectedAt: "2025-01-01T00:00:00Z",
			},
		});

		const config = await getBridgeConfig();
		expect(config.port).toBe(8888);
		expect(config.enabled).toBe(false);
		expect(config.connectedAt).toBe("2025-01-01T00:00:00Z");
	});

	test("falls back to defaults for invalid port value", async () => {
		chromeStorageMock.setStore({
			[STORAGE_KEY]: { port: -1, enabled: true },
		});

		const config = await getBridgeConfig();
		expect(config.port).toBe(DEFAULT_PORT);
	});

	test("falls back to defaults for non-numeric port", async () => {
		chromeStorageMock.setStore({
			[STORAGE_KEY]: { port: "not-a-number", enabled: true },
		});

		const config = await getBridgeConfig();
		expect(config.port).toBe(DEFAULT_PORT);
	});

	test("falls back to defaults when storage is missing the key", async () => {
		chromeStorageMock.setStore({ otherKey: "value" });

		const config = await getBridgeConfig();
		expect(config.port).toBe(DEFAULT_PORT);
		expect(config.enabled).toBe(true);
	});

	test("returns defaults on storage error", async () => {
		chromeStorageMock.get.mockRejectedValueOnce(
			new Error("Storage unavailable"),
		);

		const config = await getBridgeConfig();
		expect(config.port).toBe(DEFAULT_PORT);
		expect(config.enabled).toBe(true);
	});
});

describe("chrome-storage — saveBridgeConfig", () => {
	test("persists partial config to storage", async () => {
		chromeStorageMock.setStore({
			[STORAGE_KEY]: { port: 9000, enabled: true },
		});

		await saveBridgeConfig({ port: 9999 });

		const stored = chromeStorageMock.getStore();
		const config = stored[STORAGE_KEY] as Record<string, unknown>;
		expect(config).toEqual({ port: 9999, enabled: true });
	});

	test("handles storage errors gracefully", async () => {
		chromeStorageMock.set.mockRejectedValueOnce(new Error("Write failed"));

		// Should not throw
		await expect(saveBridgeConfig({ port: 1234 })).resolves.toBeUndefined();
	});
});

describe("chrome-storage — loadPort", () => {
	test("returns the port from stored config", async () => {
		chromeStorageMock.setStore({
			[STORAGE_KEY]: { port: 7777 },
		});

		const port = await loadPort();
		expect(port).toBe(7777);
	});

	test("returns default port when no config exists", async () => {
		chromeStorageMock.reset();

		const port = await loadPort();
		expect(port).toBe(DEFAULT_PORT);
	});
});

describe("chrome-storage — savePort", () => {
	test("persists port to storage", async () => {
		await savePort(8080);

		const stored = chromeStorageMock.getStore();
		const config = stored[STORAGE_KEY] as Record<string, unknown>;
		expect(config?.port).toBe(8080);
	});
});

describe("chrome-storage — getAllowlist", () => {
	test("returns stored allowlist", async () => {
		chromeStorageMock.setStore({
			[ALLOWLIST_KEY]: ["example.com", "test.com"],
		});

		const allowlist = await getAllowlist();
		expect(allowlist).toEqual(["example.com", "test.com"]);
	});

	test("returns default allowlist when no value is stored", async () => {
		chromeStorageMock.reset();

		const allowlist = await getAllowlist();
		expect(allowlist).toEqual(DEFAULT_ALLOWLIST);
		expect(allowlist).toEqual(["*"]);
	});

	test("returns default allowlist when stored value is not an array", async () => {
		chromeStorageMock.setStore({
			[ALLOWLIST_KEY]: "not-an-array",
		});

		const allowlist = await getAllowlist();
		expect(allowlist).toEqual(DEFAULT_ALLOWLIST);
	});

	test("returns default allowlist on storage error", async () => {
		chromeStorageMock.get.mockRejectedValueOnce(
			new Error("Storage unavailable"),
		);

		const allowlist = await getAllowlist();
		expect(allowlist).toEqual(DEFAULT_ALLOWLIST);
	});
});

describe("chrome-storage — saveAllowlist", () => {
	test("persists allowlist to storage", async () => {
		await saveAllowlist(["example.com", "other.com"]);

		const stored = chromeStorageMock.getStore();
		expect(stored[ALLOWLIST_KEY]).toEqual(["example.com", "other.com"]);
	});

	test("handles storage errors gracefully", async () => {
		chromeStorageMock.set.mockRejectedValueOnce(new Error("Write failed"));

		await expect(saveAllowlist(["example.com"])).resolves.toBeUndefined();
	});
});

describe("chrome-storage — initializeAllowlist", () => {
	test("sets default allowlist when key does not exist", async () => {
		chromeStorageMock.reset(); // Empty store

		await initializeAllowlist();

		const stored = chromeStorageMock.getStore();
		expect(stored[ALLOWLIST_KEY]).toEqual(DEFAULT_ALLOWLIST);
	});

	test("does NOT overwrite existing allowlist", async () => {
		chromeStorageMock.setStore({
			[ALLOWLIST_KEY]: ["custom-domain.com"],
		});

		await initializeAllowlist();

		const stored = chromeStorageMock.getStore();
		expect(stored[ALLOWLIST_KEY]).toEqual(["custom-domain.com"]);
	});

	test("handles storage errors gracefully", async () => {
		chromeStorageMock.get.mockRejectedValueOnce(
			new Error("Storage unavailable"),
		);

		await expect(initializeAllowlist()).resolves.toBeUndefined();
	});
});
