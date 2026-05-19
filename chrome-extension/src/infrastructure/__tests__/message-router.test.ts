/**
 * Service worker message routing tests.
 *
 * Tests `createMessageRouter` with mocked dependencies (WebSocket client,
 * Chrome tabs, Chrome storage, and handlers). Validates that incoming
 * WebSocket messages are correctly parsed, validated, and routed.
 *
 * @module infrastructure/__tests__/message-router.test
 */

import type { Response } from "@agent-browser-bridge/protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	chromeStorageMock,
	chromeTabsMock,
} from "../../__tests__/mocks/index.js";
import { ALLOWLIST_KEY } from "../chrome-storage.js";
import {
	createMessageRouter,
	type MessageRouterOptions,
} from "../message-router.js";
import type { WebSocketClient } from "../websocket-client.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function createSpyLogger() {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

/** Create a minimal mock WebSocket client for message-router tests. */
function createMockWsClient(): WebSocketClient {
	return {
		send: vi.fn(),
		isOpen: vi.fn().mockReturnValue(true),
	} as unknown as WebSocketClient;
}

/** Helper to create MessageRouterOptions with default mock handlers. */
function createRouterOptions(
	overrides: {
		wsClient?: WebSocketClient;
		enabled?: { current: boolean };
		activeTabId?: { current: number | null };
		handleNavigate?: ReturnType<typeof vi.fn>;
		handleScreenshot?: ReturnType<typeof vi.fn>;
		handleListTabs?: ReturnType<typeof vi.fn>;
		handleCloseTab?: ReturnType<typeof vi.fn>;
	} = {},
): MessageRouterOptions {
	return {
		logger: createSpyLogger(),
		wsClient: overrides.wsClient ?? createMockWsClient(),
		enabled: overrides.enabled ?? { current: true },
		activeTabId: overrides.activeTabId ?? { current: 1 },
		handleNavigate: overrides.handleNavigate ?? vi.fn(),
		handleScreenshot: overrides.handleScreenshot ?? vi.fn(),
		handleListTabs: overrides.handleListTabs ?? vi.fn(),
		handleCloseTab: overrides.handleCloseTab ?? vi.fn(),
	} as unknown as MessageRouterOptions;
}

/** Parse the sent response from the mock wsClient. */
function getSentResponse(
	wsClient: WebSocketClient,
	callIndex = 0,
): Response | null {
	const sendMock = wsClient.send as ReturnType<typeof vi.fn>;
	const calls = sendMock.mock.calls;
	if (calls.length <= callIndex) return null;
	try {
		return JSON.parse(calls[callIndex]?.[0] as string) as Response;
	} catch {
		return null;
	}
}

/** Get all sent responses. */
function _getAllSentResponses(wsClient: WebSocketClient): Response[] {
	const sendMock = wsClient.send as ReturnType<typeof vi.fn>;
	return sendMock.mock.calls
		.map((c: any[]) => {
			try {
				return JSON.parse(c[0]) as Response;
			} catch {
				return null;
			}
		})
		.filter(Boolean) as Response[];
}

// ── Setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
	// Install mocks on globalThis.chrome
	const g = globalThis as Record<string, unknown>;
	const chrome = (g.chrome = g.chrome ?? {}) as Record<string, unknown>;
	chrome.tabs = chromeTabsMock;
	chrome.storage = { local: chromeStorageMock };

	chromeTabsMock.reset();
	chromeStorageMock.reset();

	// Default allowlist: ["*"] (all domains allowed)
	chromeStorageMock.setStore({
		[ALLOWLIST_KEY]: ["*"],
	});

	// Default active tab with a valid URL
	chromeTabsMock.setTabs([{ id: 1, url: "https://example.com", active: true }]);
});

afterEach(() => {
	vi.clearAllMocks();
});

// ── Message parsing validation tests ─────────────────────────────────────

describe("createMessageRouter — message parsing and validation", () => {
	test("rejects invalid JSON with UNKNOWN_ACTION", async () => {
		const wsClient = createMockWsClient();
		const handleMessage = createMessageRouter(
			createRouterOptions({ wsClient }),
		);

		await handleMessage("not valid json {{{");

		const resp = getSentResponse(wsClient);
		expect(resp?.error).toBeDefined();
		expect(resp?.error?.code).toBe("UNKNOWN_ACTION");
		expect(resp?.error?.message).toContain("Invalid JSON");
	});

	test("rejects non-object JSON with UNKNOWN_ACTION", async () => {
		const wsClient = createMockWsClient();
		const handleMessage = createMessageRouter(
			createRouterOptions({ wsClient }),
		);

		await handleMessage('"just a string"');

		const resp = getSentResponse(wsClient);
		expect(resp?.error).toBeDefined();
		expect(resp?.error?.code).toBe("UNKNOWN_ACTION");
		expect(resp?.error?.message).toContain("must be a JSON object");
	});

	test("rejects null JSON with UNKNOWN_ACTION", async () => {
		const wsClient = createMockWsClient();
		const handleMessage = createMessageRouter(
			createRouterOptions({ wsClient }),
		);

		await handleMessage("null");

		const resp = getSentResponse(wsClient);
		expect(resp?.error).toBeDefined();
		expect(resp?.error?.code).toBe("UNKNOWN_ACTION");
	});

	test("rejects missing id field with empty id in response", async () => {
		const wsClient = createMockWsClient();
		const handleMessage = createMessageRouter(
			createRouterOptions({ wsClient }),
		);

		await handleMessage('{"action":"read"}');

		const resp = getSentResponse(wsClient);
		expect(resp?.error).toBeDefined();
		expect(resp?.error?.code).toBe("UNKNOWN_ACTION");
		expect(resp?.id).toBe("");
	});

	test("rejects empty id with UNKNOWN_ACTION", async () => {
		const wsClient = createMockWsClient();
		const handleMessage = createMessageRouter(
			createRouterOptions({ wsClient }),
		);

		await handleMessage('{"id":"","action":"read"}');

		const resp = getSentResponse(wsClient);
		expect(resp?.error).toBeDefined();
		expect(resp?.error?.code).toBe("UNKNOWN_ACTION");
		expect(resp?.id).toBe("");
	});

	test("rejects missing action field", async () => {
		const wsClient = createMockWsClient();
		const handleMessage = createMessageRouter(
			createRouterOptions({ wsClient }),
		);

		await handleMessage('{"id":"req-1"}');

		const resp = getSentResponse(wsClient);
		expect(resp?.error).toBeDefined();
		expect(resp?.error?.code).toBe("UNKNOWN_ACTION");
		expect(resp?.id).toBe("req-1");
	});

	test("rejects unknown action name", async () => {
		const wsClient = createMockWsClient();
		const handleMessage = createMessageRouter(
			createRouterOptions({ wsClient }),
		);

		await handleMessage('{"id":"req-1","action":"deleteEverything"}');

		const resp = getSentResponse(wsClient);
		expect(resp?.error).toBeDefined();
		expect(resp?.error?.code).toBe("UNKNOWN_ACTION");
		expect(resp?.error?.message).toContain('"deleteEverything"');
		expect(resp?.id).toBe("req-1");
	});

	test("accepts all valid action names", async () => {
		const validActions = [
			"navigate",
			"click",
			"type",
			"screenshot",
			"read",
			"exec",
			"waitForElement",
			"waitForText",
			"listTabs",
			"closeTab",
		];

		for (const action of validActions) {
			const wsClient = createMockWsClient();
			const handleNavigate = vi
				.fn()
				.mockResolvedValue({ id: "req-1", result: "ok" });
			const handleScreenshot = vi
				.fn()
				.mockResolvedValue({ id: "req-1", result: "ok" });
			const handleListTabs = vi
				.fn()
				.mockResolvedValue({ id: "req-1", result: { tabs: [] } });
			const handleCloseTab = vi
				.fn()
				.mockResolvedValue({ id: "req-1", result: { closed: true } });
			const handleMessage = createMessageRouter({
				logger: createSpyLogger(),
				wsClient,
				enabled: { current: true },
				activeTabId: { current: 1 },
				handleNavigate,
				handleScreenshot,
				handleListTabs,
				handleCloseTab,
			});

			// Set up tabs for non-navigate/screenshot actions
			chromeTabsMock.setTabs([
				{ id: 1, url: "https://example.com", active: true },
			]);
			chromeTabsMock.sendMessage.mockResolvedValue({
				id: "req-1",
				result: "ok",
			});

			await handleMessage(JSON.stringify({ id: "req-1", action, params: {} }));

			const resp = getSentResponse(wsClient);

			// All valid actions should NOT produce an UNKNOWN_ACTION error
			// They may produce other errors (params validation, etc.) but not UNKNOWN_ACTION
			if (resp?.error) {
				expect(resp.error.code).not.toBe("UNKNOWN_ACTION");
			}
		}
	});
});

// ── Disabled bridge tests ────────────────────────────────────────────────

describe("createMessageRouter — disabled bridge", () => {
	test("rejects all messages when bridge is disabled", async () => {
		const wsClient = createMockWsClient();
		const handleMessage = createMessageRouter(
			createRouterOptions({ wsClient, enabled: { current: false } }),
		);

		await handleMessage('{"id":"req-1","action":"read"}');

		const resp = getSentResponse(wsClient);
		expect(resp?.error).toBeDefined();
		expect(resp?.error?.code).toBe("BROWSER_NOT_CONNECTED");
		expect(resp?.error?.message).toContain("disabled");
		expect(resp?.id).toBe("req-1");
	});

	test("logs info message when bridge is disabled", async () => {
		const wsClient = createMockWsClient();
		const options = createRouterOptions({
			wsClient,
			enabled: { current: false },
		});
		const handleMessage = createMessageRouter(options);

		await handleMessage('{"id":"req-1","action":"read"}');

		expect(options.logger.info).toHaveBeenCalledWith(
			expect.stringContaining("disabled"),
		);
	});
});

// ── Navigate routing tests ───────────────────────────────────────────────

describe("createMessageRouter — navigate routing", () => {
	test("routes navigate actions to handleNavigate handler", async () => {
		const wsClient = createMockWsClient();
		const handleNavigate = vi.fn().mockResolvedValue({
			id: "req-1",
			result: { url: "https://target.com", title: "Target" },
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({
				wsClient,
				handleNavigate,
			}),
		);

		await handleMessage(
			JSON.stringify({
				id: "req-1",
				action: "navigate",
				params: { url: "https://target.com" },
			}),
		);

		expect(handleNavigate).toHaveBeenCalledWith(
			"req-1",
			expect.objectContaining({ url: "https://target.com" }),
		);

		const resp = getSentResponse(wsClient);
		expect(resp?.result).toBeDefined();
		expect((resp?.result as any)?.url).toBe("https://target.com");
	});

	test("returns error when handleNavigate fails", async () => {
		const wsClient = createMockWsClient();
		const handleNavigate = vi.fn().mockResolvedValue({
			id: "req-1",
			error: { code: "INVALID_URL", message: "Invalid URL" },
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({
				wsClient,
				handleNavigate,
			}),
		);

		await handleMessage(
			JSON.stringify({
				id: "req-1",
				action: "navigate",
				params: { url: "bad-url" },
			}),
		);

		const resp = getSentResponse(wsClient);
		expect(resp?.error).toBeDefined();
		expect(resp?.error?.code).toBe("INVALID_URL");
	});

	test("navigate does NOT check domain allowlist", async () => {
		// Navigate should skip the domain allowlist check entirely
		const wsClient = createMockWsClient();
		const handleNavigate = vi.fn().mockResolvedValue({
			id: "req-1",
			result: { url: "https://target.com", title: "Target" },
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({
				wsClient,
				handleNavigate,
			}),
		);

		await handleMessage(
			JSON.stringify({
				id: "req-1",
				action: "navigate",
				params: { url: "https://target.com" },
			}),
		);

		// Should send response without a RESTRICTED_DOMAIN error
		const resp = getSentResponse(wsClient);
		expect(resp?.error?.code).not.toBe("RESTRICTED_DOMAIN");
		expect(resp?.result).toBeDefined();
	});
});

// ── Screenshot routing tests ─────────────────────────────────────────────

describe("createMessageRouter — screenshot routing", () => {
	test("routes screenshot actions to handleScreenshot handler", async () => {
		const wsClient = createMockWsClient();
		const handleScreenshot = vi.fn().mockResolvedValue({
			id: "req-1",
			result: { data: "base64data", format: "png" },
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({
				wsClient,
				handleScreenshot,
			}),
		);

		await handleMessage(
			JSON.stringify({
				id: "req-1",
				action: "screenshot",
				params: { format: "png" },
			}),
		);

		expect(handleScreenshot).toHaveBeenCalledWith("req-1", {
			format: "png",
		});

		const resp = getSentResponse(wsClient);
		expect(resp?.result).toBeDefined();
		expect((resp?.result as any)?.data).toBe("base64data");
	});

	test("screenshot does NOT check domain allowlist", async () => {
		const wsClient = createMockWsClient();
		const handleScreenshot = vi.fn().mockResolvedValue({
			id: "req-1",
			result: { data: "base64string", format: "png" },
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({
				wsClient,
				handleScreenshot,
			}),
		);

		await handleMessage(
			JSON.stringify({
				id: "req-1",
				action: "screenshot",
				params: { format: "png" },
			}),
		);

		const resp = getSentResponse(wsClient);
		expect(resp?.error?.code).not.toBe("RESTRICTED_DOMAIN");
	});

	test("returns error when handleScreenshot fails", async () => {
		const wsClient = createMockWsClient();
		const handleScreenshot = vi.fn().mockResolvedValue({
			id: "req-1",
			error: { code: "RESTRICTED_URL", message: "Cannot screenshot chrome://" },
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({
				wsClient,
				handleScreenshot,
			}),
		);

		await handleMessage(
			JSON.stringify({
				id: "req-1",
				action: "screenshot",
				params: { format: "png" },
			}),
		);

		const resp = getSentResponse(wsClient);
		expect(resp?.error).toBeDefined();
		expect(resp?.error?.code).toBe("RESTRICTED_URL");
	});
});

// ── Tab management routing tests ─────────────────────────────────────────

describe("createMessageRouter — listTabs routing", () => {
	test("routes listTabs actions to handleListTabs handler", async () => {
		const wsClient = createMockWsClient();
		const handleListTabs = vi.fn().mockResolvedValue({
			id: "req-1",
			result: {
				tabs: [
					{
						tabId: 1,
						url: "https://example.com",
						title: "Example",
						active: true,
					},
				],
			},
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({
				wsClient,
				handleListTabs,
			}),
		);

		await handleMessage(
			JSON.stringify({
				id: "req-1",
				action: "listTabs",
				params: { currentWindowOnly: true },
			}),
		);

		expect(handleListTabs).toHaveBeenCalledWith(
			"req-1",
			expect.objectContaining({ currentWindowOnly: true }),
		);

		const resp = getSentResponse(wsClient);
		expect(resp?.result).toBeDefined();
		expect((resp?.result as any)?.tabs).toHaveLength(1);
	});

	test("listTabs does NOT check domain allowlist", async () => {
		const wsClient = createMockWsClient();
		const handleListTabs = vi.fn().mockResolvedValue({
			id: "req-1",
			result: { tabs: [] },
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({
				wsClient,
				handleListTabs,
			}),
		);

		await handleMessage(
			JSON.stringify({ id: "req-1", action: "listTabs", params: {} }),
		);

		const resp = getSentResponse(wsClient);
		expect(resp?.error?.code).not.toBe("RESTRICTED_DOMAIN");
	});

	test("returns error when handleListTabs fails", async () => {
		const wsClient = createMockWsClient();
		const handleListTabs = vi.fn().mockResolvedValue({
			id: "req-1",
			error: { code: "UNKNOWN_ACTION", message: "Failed to query tabs" },
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({
				wsClient,
				handleListTabs,
			}),
		);

		await handleMessage(
			JSON.stringify({ id: "req-1", action: "listTabs", params: {} }),
		);

		const resp = getSentResponse(wsClient);
		expect(resp?.error).toBeDefined();
		expect(resp?.error?.code).toBe("UNKNOWN_ACTION");
	});
});

describe("createMessageRouter — closeTab routing", () => {
	test("routes closeTab actions to handleCloseTab handler", async () => {
		const wsClient = createMockWsClient();
		const handleCloseTab = vi.fn().mockResolvedValue({
			id: "req-1",
			result: { closed: true },
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({
				wsClient,
				handleCloseTab,
			}),
		);

		await handleMessage(
			JSON.stringify({
				id: "req-1",
				action: "closeTab",
				params: { tabId: 42 },
			}),
		);

		expect(handleCloseTab).toHaveBeenCalledWith(
			"req-1",
			expect.objectContaining({ tabId: 42 }),
		);

		const resp = getSentResponse(wsClient);
		expect(resp?.result).toBeDefined();
		expect((resp?.result as any)?.closed).toBe(true);
	});

	test("closeTab does NOT check domain allowlist", async () => {
		const wsClient = createMockWsClient();
		const handleCloseTab = vi.fn().mockResolvedValue({
			id: "req-1",
			result: { closed: true },
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({
				wsClient,
				handleCloseTab,
			}),
		);

		await handleMessage(
			JSON.stringify({ id: "req-1", action: "closeTab", params: { tabId: 1 } }),
		);

		const resp = getSentResponse(wsClient);
		expect(resp?.error?.code).not.toBe("RESTRICTED_DOMAIN");
	});

	test("returns TAB_NOT_FOUND when tab does not exist", async () => {
		const wsClient = createMockWsClient();
		const handleCloseTab = vi.fn().mockResolvedValue({
			id: "req-1",
			error: { code: "TAB_NOT_FOUND", message: "Tab 999 not found" },
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({
				wsClient,
				handleCloseTab,
			}),
		);

		await handleMessage(
			JSON.stringify({
				id: "req-1",
				action: "closeTab",
				params: { tabId: 999 },
			}),
		);

		const resp = getSentResponse(wsClient);
		expect(resp?.error).toBeDefined();
		expect(resp?.error?.code).toBe("TAB_NOT_FOUND");
	});
});

// ── Content script forwarding tests ──────────────────────────────────────

describe("createMessageRouter — content script forwarding", () => {
	test("forwards click action to content script", async () => {
		const wsClient = createMockWsClient();

		chromeTabsMock.sendMessage.mockResolvedValue({
			id: "req-1",
			result: {
				clicked: true,
				selector: "#btn",
				text: "Click Me",
				navigated: false,
			},
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({ wsClient }),
		);

		await handleMessage(
			JSON.stringify({
				id: "req-1",
				action: "click",
				params: { selector: "#btn" },
			}),
		);

		const resp = getSentResponse(wsClient);
		expect(resp?.result).toBeDefined();
		expect((resp?.result as any)?.clicked).toBe(true);
	});

	test("forwards type action to content script", async () => {
		const wsClient = createMockWsClient();

		chromeTabsMock.sendMessage.mockResolvedValue({
			id: "req-2",
			result: { typed: true, selector: "#input", value: "hello" },
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({ wsClient }),
		);

		await handleMessage(
			JSON.stringify({
				id: "req-2",
				action: "type",
				params: { selector: "#input", text: "hello" },
			}),
		);

		const resp = getSentResponse(wsClient);
		expect(resp?.result).toBeDefined();
		expect((resp?.result as any)?.typed).toBe(true);
	});

	test("forwards read action to content script", async () => {
		const wsClient = createMockWsClient();

		chromeTabsMock.sendMessage.mockResolvedValue({
			id: "req-3",
			result: { text: "Page content", length: 12, truncated: false },
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({ wsClient }),
		);

		await handleMessage(
			JSON.stringify({ id: "req-3", action: "read", params: {} }),
		);

		const resp = getSentResponse(wsClient);
		expect(resp?.result).toBeDefined();
		expect((resp?.result as any)?.text).toBe("Page content");
	});

	test("forwards exec action to content script", async () => {
		const wsClient = createMockWsClient();

		chromeTabsMock.sendMessage.mockResolvedValue({
			id: "req-4",
			result: { value: 5, serialized: "5" },
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({ wsClient }),
		);

		await handleMessage(
			JSON.stringify({
				id: "req-4",
				action: "exec",
				params: { code: "2+3" },
			}),
		);

		const resp = getSentResponse(wsClient);
		expect(resp?.result).toBeDefined();
		expect((resp?.result as any)?.value).toBe(5);
	});

	test("forwards waitForElement action to content script", async () => {
		const wsClient = createMockWsClient();

		chromeTabsMock.sendMessage.mockResolvedValue({
			id: "req-5",
			result: {
				found: true,
				selector: "#target",
				tagName: "BUTTON",
				elapsedMs: 25,
			},
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({ wsClient }),
		);

		await handleMessage(
			JSON.stringify({
				id: "req-5",
				action: "waitForElement",
				params: { selector: "#target", timeout: 1000 },
			}),
		);

		const resp = getSentResponse(wsClient);
		expect(resp?.result).toBeDefined();
		expect((resp?.result as any)?.found).toBe(true);
	});

	test("forwards waitForText action to content script", async () => {
		const wsClient = createMockWsClient();

		chromeTabsMock.sendMessage.mockResolvedValue({
			id: "req-6",
			result: { found: true, text: "Hello", elapsedMs: 50 },
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({ wsClient }),
		);

		await handleMessage(
			JSON.stringify({
				id: "req-6",
				action: "waitForText",
				params: { text: "Hello", timeout: 1000 },
			}),
		);

		const resp = getSentResponse(wsClient);
		expect(resp?.result).toBeDefined();
		expect((resp?.result as any)?.found).toBe(true);
	});

	test("returns error when no active tab is available", async () => {
		const wsClient = createMockWsClient();

		// No tabs at all
		chromeTabsMock.setTabs([]);

		const handleMessage = createMessageRouter(
			createRouterOptions({ wsClient, activeTabId: { current: null } }),
		);

		await handleMessage(
			JSON.stringify({ id: "req-1", action: "read", params: {} }),
		);

		const resp = getSentResponse(wsClient);
		expect(resp?.error).toBeDefined();
		expect(resp?.error?.code).toBe("BROWSER_NOT_CONNECTED");
		expect(resp?.error?.message).toContain("No active tab");
	});
});

// ── Domain allowlist enforcement tests ───────────────────────────────────

describe("createMessageRouter — domain allowlist enforcement", () => {
	test("allows actions when domain is in the allowlist", async () => {
		const wsClient = createMockWsClient();

		chromeStorageMock.setStore({
			[ALLOWLIST_KEY]: ["example.com"],
		});

		chromeTabsMock.setTabs([
			{ id: 1, url: "https://example.com/page", active: true },
		]);

		chromeTabsMock.sendMessage.mockResolvedValue({
			id: "req-1",
			result: { text: "content" },
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({ wsClient }),
		);

		await handleMessage(
			JSON.stringify({ id: "req-1", action: "read", params: {} }),
		);

		const resp = getSentResponse(wsClient);
		// Should succeed (not restricted)
		expect(resp?.error?.code).not.toBe("RESTRICTED_DOMAIN");
		expect(resp?.result).toBeDefined();
	});

	test("blocks action when domain is NOT in the allowlist", async () => {
		const wsClient = createMockWsClient();

		chromeStorageMock.setStore({
			[ALLOWLIST_KEY]: ["allowed-domain.com"],
		});

		chromeTabsMock.setTabs([
			{ id: 1, url: "https://blocked-domain.com/page", active: true },
		]);

		const handleMessage = createMessageRouter(
			createRouterOptions({ wsClient }),
		);

		await handleMessage(
			JSON.stringify({ id: "req-1", action: "read", params: {} }),
		);

		const resp = getSentResponse(wsClient);
		expect(resp?.error).toBeDefined();
		expect(resp?.error?.code).toBe("RESTRICTED_DOMAIN");
		expect(resp?.error?.message).toContain("blocked-domain.com");
		expect(resp?.error?.message).toContain("allowlist");
	});

	test("allows all domains when allowlist is ['*']", async () => {
		const wsClient = createMockWsClient();

		chromeStorageMock.setStore({
			[ALLOWLIST_KEY]: ["*"],
		});

		chromeTabsMock.setTabs([
			{ id: 1, url: "https://random-domain.org/whatever", active: true },
		]);

		chromeTabsMock.sendMessage.mockResolvedValue({
			id: "req-1",
			result: { text: "page text" },
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({ wsClient }),
		);

		await handleMessage(
			JSON.stringify({ id: "req-1", action: "read", params: {} }),
		);

		const resp = getSentResponse(wsClient);
		expect(resp?.error?.code).not.toBe("RESTRICTED_DOMAIN");
	});

	test("skips domain check when tab URL is unavailable", async () => {
		const wsClient = createMockWsClient();

		// Tabs exist but no URL
		chromeTabsMock.setTabs([
			{ id: 1, active: true }, // No URL
		]);

		chromeTabsMock.sendMessage.mockResolvedValue({
			id: "req-1",
			result: { text: "ok" },
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({ wsClient }),
		);

		await handleMessage(
			JSON.stringify({ id: "req-1", action: "read", params: {} }),
		);

		// Should fall through to forwarding (no domain to check)
		const resp = getSentResponse(wsClient);
		expect(resp?.error?.code).not.toBe("RESTRICTED_DOMAIN");
	});

	test("navigate actions skip domain allowlist check", async () => {
		const wsClient = createMockWsClient();

		chromeStorageMock.setStore({
			[ALLOWLIST_KEY]: ["allowed-only.com"],
		});

		chromeTabsMock.setTabs([
			{ id: 1, url: "https://blocked.com/page", active: true },
		]);

		const handleNavigate = vi.fn().mockResolvedValue({
			id: "req-1",
			result: { url: "https://somewhere-else.com", title: "Else" },
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({
				wsClient,
				handleNavigate,
			}),
		);

		await handleMessage(
			JSON.stringify({
				id: "req-1",
				action: "navigate",
				params: { url: "https://somewhere-else.com" },
			}),
		);

		const resp = getSentResponse(wsClient);
		// Navigate should NOT be blocked by domain allowlist
		expect(resp?.error?.code).not.toBe("RESTRICTED_DOMAIN");
	});
});

// ── Active tab ID handling tests ─────────────────────────────────────────

describe("createMessageRouter — active tab ID handling", () => {
	test("resolves activeTabId when it is null (lazy resolution)", async () => {
		const wsClient = createMockWsClient();

		chromeTabsMock.setTabs([
			{ id: 42, url: "https://example.com", active: true },
		]);

		chromeTabsMock.sendMessage.mockResolvedValue({
			id: "req-1",
			result: { text: "hello" },
		});

		// Start with null activeTabId — should be resolved to 42
		const activeTabId = { current: null as number | null };

		const handleMessage = createMessageRouter(
			createRouterOptions({ wsClient, activeTabId }),
		);

		await handleMessage(
			JSON.stringify({ id: "req-1", action: "read", params: {} }),
		);

		// activeTabId should now be resolved
		expect(activeTabId.current).toBe(42);

		const resp = getSentResponse(wsClient);
		expect(resp?.error?.code).not.toBe("BROWSER_NOT_CONNECTED");
	});

	test("returns error when activeTabId is null and no active tab exists", async () => {
		const wsClient = createMockWsClient();

		chromeTabsMock.setTabs([]); // No tabs at all

		const activeTabId = { current: null as number | null };

		const handleMessage = createMessageRouter(
			createRouterOptions({ wsClient, activeTabId }),
		);

		await handleMessage(
			JSON.stringify({ id: "req-1", action: "read", params: {} }),
		);

		const resp = getSentResponse(wsClient);
		expect(resp?.error).toBeDefined();
		expect(resp?.error?.code).toBe("BROWSER_NOT_CONNECTED");
		expect(resp?.error?.message).toContain("No active tab");
	});
});

// ── Logging tests ────────────────────────────────────────────────────────

describe("createMessageRouter — logging", () => {
	test("logs incoming messages", async () => {
		const wsClient = createMockWsClient();
		const options = createRouterOptions({ wsClient });

		chromeTabsMock.sendMessage.mockResolvedValue({
			id: "req-1",
			result: { text: "content" },
		});

		const handleMessage = createMessageRouter(options);

		await handleMessage(
			JSON.stringify({ id: "req-1", action: "read", params: {} }),
		);

		expect(options.logger.info).toHaveBeenCalledWith(
			expect.stringContaining("Received:"),
		);
	});

	test("truncates long messages in logs", async () => {
		const wsClient = createMockWsClient();
		const options = createRouterOptions({ wsClient });

		chromeTabsMock.sendMessage.mockResolvedValue({
			id: "req-1",
			result: { text: "content" },
		});

		const handleMessage = createMessageRouter(options);

		const longString = "x".repeat(300);
		await handleMessage(
			JSON.stringify({
				id: "req-1",
				action: "read",
				params: { data: longString },
			}),
		);

		const logCall = (
			options.logger.info as ReturnType<typeof vi.fn>
		).mock.calls.find(
			(c: any[]) => typeof c[0] === "string" && c[0].includes("Received:"),
		);
		expect(logCall).toBeDefined();
		// Should be truncated (contains "…")
		expect(logCall![0] as string).toContain("…");
	});
});

// ── Edge cases ───────────────────────────────────────────────────────────

describe("createMessageRouter — edge cases", () => {
	test("handles message with non-string id (still works)", async () => {
		const wsClient = createMockWsClient();
		const handleMessage = createMessageRouter(
			createRouterOptions({ wsClient }),
		);

		// id should be a string per protocol, but we should handle gracefully
		await handleMessage('{"id":123,"action":"read"}');

		// parseRequest uses typeof obj.id === "string" check
		const resp = getSentResponse(wsClient);
		// Since id is number not string, it fails validation
		expect(resp?.error).toBeDefined();
	});

	test("does NOT mutate enabled ref or activeTabId ref unexpectedly for navigate", async () => {
		const wsClient = createMockWsClient();
		const enabled = { current: true };
		const activeTabId = { current: 1 };
		const handleNavigate = vi.fn().mockResolvedValue({
			id: "req-1",
			result: { url: "https://new.com", title: "New" },
		});

		const handleMessage = createMessageRouter(
			createRouterOptions({
				wsClient,
				enabled,
				activeTabId,
				handleNavigate,
			}),
		);

		await handleMessage(
			JSON.stringify({
				id: "req-1",
				action: "navigate",
				params: { url: "https://new.com" },
			}),
		);

		// Navigate should not change activeTabId
		expect(activeTabId.current).toBe(1);
		expect(enabled.current).toBe(true);
	});
});
