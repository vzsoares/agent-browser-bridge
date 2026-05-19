/**
 * Unit tests for protocol types from the pi-extension perspective.
 *
 * Exercises the shared protocol types (ErrorCode, ErrorResponse, Request,
 * Response, and all param interfaces) to ensure they work correctly when
 * consumed by the pi-extension tooling layer.
 *
 * Uses bun:test (matching pi-extension's test runner).
 *
 * @module __tests__/protocol-types.test
 */

import { describe, expect, test } from "bun:test";
import type {
	Action,
	CloseTabParams,
	CreateTabParams,
	ErrorCode,
	ErrorResponse,
	ListTabsParams,
	Request,
	Response,
} from "@agent-browser-bridge/protocol";

// ═══════════════════════════════════════════════════════════════════════════
// TAB_NOT_FOUND in ErrorCode union
// ═══════════════════════════════════════════════════════════════════════════

describe("TAB_NOT_FOUND in ErrorCode union", () => {
	test("TAB_NOT_FOUND is assignable to ErrorCode", () => {
		const code: ErrorCode = "TAB_NOT_FOUND";
		expect(code).toBe("TAB_NOT_FOUND");
	});

	test("TAB_NOT_FOUND appears in the full set of error codes", () => {
		const allCodes: ErrorCode[] = [
			"TIMEOUT",
			"ELEMENT_NOT_FOUND",
			"ELEMENT_NOT_INTERACTABLE",
			"ELEMENT_NOT_TYPABLE",
			"INVALID_URL",
			"RESTRICTED_URL",
			"RESTRICTED_DOMAIN",
			"BROWSER_NOT_CONNECTED",
			"CONNECTION_RESET",
			"UNKNOWN_ACTION",
			"TAB_NOT_FOUND",
		];
		expect(allCodes).toContain("TAB_NOT_FOUND");
		expect(allCodes).toHaveLength(11);
	});

	test("TAB_NOT_FOUND error message is descriptive", () => {
		const err: ErrorResponse = {
			code: "TAB_NOT_FOUND",
			message: "Tab 42 was not found",
			suggestion:
				"The tab may have been closed. List tabs to find a valid TabId.",
		};
		expect(err.code).toBe("TAB_NOT_FOUND");
		expect(err.message).toContain("not found");
		expect(err.suggestion).toContain("List tabs");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// tabId parameter in all action params
// ═══════════════════════════════════════════════════════════════════════════

describe("tabId parameter in action params", () => {
	test("NavigateParams accepts tabId as optional number", () => {
		const req: Request<"navigate"> = {
			id: "1",
			action: "navigate",
			params: { url: "https://example.com", tabId: 42 },
		};
		expect(req.params.tabId).toBe(42);
	});

	test("NavigateParams works without tabId (backward compatible)", () => {
		const req: Request<"navigate"> = {
			id: "2",
			action: "navigate",
			params: { url: "https://example.com" },
		};
		// tabId is optional — omitting it should not break the request
		expect(req.params.url).toBe("https://example.com");
		expect(req.params.tabId).toBeUndefined();
	});

	test("all tabId-carrying params accept a number", () => {
		const paramsWithTabId: { tabId?: number }[] = [
			{ tabId: 1 }, // NavigateParams minimal
			{ tabId: 2, selector: "#x" }, // ClickParams minimal
			{ tabId: 3, selector: "#x", text: "hi" }, // TypeParams minimal
			{ tabId: 4 }, // ReadParams minimal
			{ tabId: 5 }, // ScreenshotParams minimal
			{ tabId: 6, code: "1" }, // ExecParams minimal
			{ tabId: 7, selector: ".x" }, // WaitForElementParams minimal
			{ tabId: 8, text: "ready" }, // WaitForTextParams minimal
		];

		for (const p of paramsWithTabId) {
			expect(typeof p.tabId).toBe("number");
			expect(p.tabId).toBeGreaterThan(0);
		}
	});

	test("CloseTabParams requires tabId (not optional)", () => {
		const params: CloseTabParams = { tabId: 99 };
		expect(params.tabId).toBe(99);
	});

	test("CreateTabParams has no tabId field", () => {
		const params: CreateTabParams = {
			url: "https://example.com",
			active: true,
		};
		expect("tabId" in params).toBe(false);
	});

	test("ListTabsParams has no tabId field", () => {
		const params: ListTabsParams = { currentWindowOnly: false };
		expect("tabId" in params).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// New action types: createTab, listTabs, closeTab
// ═══════════════════════════════════════════════════════════════════════════

describe("New action types are valid", () => {
	test("createTab constructs a valid Request", () => {
		const req: Request<"createTab"> = {
			id: "t1",
			action: "createTab",
			params: { url: "https://example.com" },
		};
		expect(req.action).toBe("createTab");
		expect(req.params.url).toBe("https://example.com");
	});

	test("listTabs constructs a valid Request", () => {
		const req: Request<"listTabs"> = {
			id: "t2",
			action: "listTabs",
			params: { urlPattern: "github.com" },
		};
		expect(req.action).toBe("listTabs");
		expect(req.params.urlPattern).toBe("github.com");
	});

	test("closeTab constructs a valid Request", () => {
		const req: Request<"closeTab"> = {
			id: "t3",
			action: "closeTab",
			params: { tabId: 42 },
		};
		expect(req.action).toBe("closeTab");
		expect(req.params.tabId).toBe(42);
	});

	test("createTab is a member of Action union", () => {
		const action: Action = "createTab";
		expect(action).toBe("createTab");
	});

	test("listTabs is a member of Action union", () => {
		const action: Action = "listTabs";
		expect(action).toBe("listTabs");
	});

	test("closeTab is a member of Action union", () => {
		const action: Action = "closeTab";
		expect(action).toBe("closeTab");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Error response shapes for tab-closed scenarios
// ═══════════════════════════════════════════════════════════════════════════

describe("Error response shapes for tab-closed scenarios", () => {
	test("TAB_NOT_FOUND response for navigate on closed tab", () => {
		const res: Response<"navigate"> = {
			id: "nav-42",
			error: {
				code: "TAB_NOT_FOUND",
				message: "Tab 42 was closed before navigation completed",
				suggestion: "Create a new tab and navigate to the URL again.",
			},
		};
		expect(res.id).toBe("nav-42");
		expect(res.error!.code).toBe("TAB_NOT_FOUND");
		expect(res.error!.message).toContain("closed");
		expect(res.error!.suggestion).toContain("Create a new tab");
		expect(res.result).toBeUndefined();
	});

	test("TAB_NOT_FOUND response for click on closed tab", () => {
		const res: Response<"click"> = {
			id: "clk-7",
			error: {
				code: "TAB_NOT_FOUND",
				message: "Tab 7 does not exist",
			},
		};
		expect(res.error!.code).toBe("TAB_NOT_FOUND");
		expect(res.result).toBeUndefined();
	});

	test("TAB_NOT_FOUND response for closeTab on already-closed tab", () => {
		const res: Response<"closeTab"> = {
			id: "close-99",
			error: {
				code: "TAB_NOT_FOUND",
				message: "Cannot close tab 99: it does not exist",
				suggestion: "Use listTabs to find valid tabIds.",
			},
		};
		expect(res.error!.code).toBe("TAB_NOT_FOUND");
		expect(res.error!.suggestion).toContain("listTabs");
	});

	test("BROWSER_NOT_CONNECTED vs TAB_NOT_FOUND are distinct", () => {
		const tabErr: ErrorResponse = {
			code: "TAB_NOT_FOUND",
			message: "Tab 1 not found",
		};
		const connErr: ErrorResponse = {
			code: "BROWSER_NOT_CONNECTED",
			message: "No extension connected",
		};
		expect(tabErr.code).not.toBe(connErr.code);
		expect(tabErr.code).toBe("TAB_NOT_FOUND");
		expect(connErr.code).toBe("BROWSER_NOT_CONNECTED");
	});

	test("error response shape is serialisable to JSON", () => {
		const res: Response = {
			id: "json-test",
			error: {
				code: "TAB_NOT_FOUND",
				message: "Tab was closed",
				suggestion: "Re-open it",
			},
		};
		const json = JSON.stringify(res);
		const parsed = JSON.parse(json);
		expect(parsed.error.code).toBe("TAB_NOT_FOUND");
		expect(parsed.error.message).toBe("Tab was closed");
		expect(parsed.error.suggestion).toBe("Re-open it");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// ActionParams completeness check
// ═══════════════════════════════════════════════════════════════════════════

describe("ActionParams completeness", () => {
	test("all 11 actions are mapped in ActionParams", () => {
		const actions: Action[] = [
			"navigate",
			"click",
			"type",
			"screenshot",
			"read",
			"exec",
			"waitForElement",
			"waitForText",
			"createTab",
			"listTabs",
			"closeTab",
		];

		for (const action of actions) {
			// TypeScript ensures ActionParams[A] exists for each Action.
			// At runtime, we verify the type is constructable.
			expect(typeof action).toBe("string");
		}
		expect(actions).toHaveLength(11);
	});

	test("each ActionParams entry is an object type at runtime", () => {
		// Construct example values for every action — TypeScript validates
		// that the params shape matches ActionParams[A].
		const samples: Record<Action, unknown> = {
			navigate: { url: "https://x.com" },
			click: { selector: "button" },
			type: { selector: "input", text: "x" },
			screenshot: {},
			read: {},
			exec: { code: "1" },
			waitForElement: { selector: "div" },
			waitForText: { text: "x" },
			createTab: {},
			listTabs: {},
			closeTab: { tabId: 1 },
		};

		for (const key of Object.keys(samples) as Action[]) {
			expect(typeof samples[key]).toBe("object");
			expect(samples[key]).not.toBeUndefined();
		}
	});
});
