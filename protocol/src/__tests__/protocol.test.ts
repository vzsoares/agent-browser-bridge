/**
 * Tests for the shared protocol types.
 *
 * Since the protocol package is types-only (no runtime code), these tests
 * verify correct type shapes, constant value sets, and structural soundness
 * at runtime via object construction and assertions.
 */

import { describe, test, expect } from "bun:test";
import type {
  Action,
  ActionParams,
  CloseTabParams,
  CreateTabParams,
  ErrorCode,
  ErrorResponse,
  ListTabsParams,
  NavigateParams,
  ReadParams,
  Request,
  Response,
  ScreenshotParams,
  TypeParams,
  ExecParams,
  WaitForElementParams,
  WaitForTextParams,
  ClickParams,
} from "@pi-browser-bridge/protocol";

// ═══════════════════════════════════════════════════════════════════════════
// Action union
// ═══════════════════════════════════════════════════════════════════════════

describe("Action type", () => {
  test("membership — all eleven actions are recognised", () => {
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
    expect(actions).toHaveLength(11);
  });

  test("each action is a non-empty string literal", () => {
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
    for (const a of actions) {
      expect(typeof a).toBe("string");
      expect(a.length).toBeGreaterThan(0);
    }
  });

  test("no duplicate action names", () => {
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
    const unique = new Set(actions);
    expect(unique.size).toBe(actions.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Error codes
// ═══════════════════════════════════════════════════════════════════════════

describe("ErrorCode type", () => {
  test("membership — all eleven error codes are recognised", () => {
    const codes: ErrorCode[] = [
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
    expect(codes).toHaveLength(11);
  });

  test("TAB_NOT_FOUND is a valid ErrorCode", () => {
    const code: ErrorCode = "TAB_NOT_FOUND";
    expect(code).toBe("TAB_NOT_FOUND");
    expect(typeof code).toBe("string");
    expect(code.length).toBeGreaterThan(0);
  });

  test("RESTRICTED_DOMAIN is a valid ErrorCode", () => {
    const code: ErrorCode = "RESTRICTED_DOMAIN";
    expect(code).toBe("RESTRICTED_DOMAIN");
    expect(typeof code).toBe("string");
  });

  test("each code is a non-empty string", () => {
    const codes: ErrorCode[] = [
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
    for (const c of codes) {
      expect(typeof c).toBe("string");
      expect(c.length).toBeGreaterThan(0);
    }
  });

  test("no duplicate error codes", () => {
    const codes: ErrorCode[] = [
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
    expect(new Set(codes).size).toBe(codes.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ErrorResponse
// ═══════════════════════════════════════════════════════════════════════════

describe("ErrorResponse", () => {
  test("full shape — code, message, suggestion", () => {
    const err: ErrorResponse = {
      code: "TIMEOUT",
      message: "Request timed out after 30s",
      suggestion: "Try again with a longer timeout",
    };
    expect(err.code).toBe("TIMEOUT");
    expect(err.message).toContain("timed out");
    expect(err.suggestion).toBeDefined();
  });

  test("minimal shape — suggestion is optional", () => {
    const err: ErrorResponse = {
      code: "UNKNOWN_ACTION",
      message: "Action 'foo' is not recognised",
    };
    expect(err.code).toBe("UNKNOWN_ACTION");
    expect(err.suggestion).toBeUndefined();
  });

  test("every error code variant constructs correctly", () => {
    const codes: ErrorCode[] = [
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
    for (const code of codes) {
      const err: ErrorResponse = { code, message: `Test: ${code}` };
      expect(err.code).toBe(code);
      expect(typeof err.message).toBe("string");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Request type
// ═══════════════════════════════════════════════════════════════════════════

describe("Request", () => {
  test("navigate — requires url", () => {
    const req: Request<"navigate"> = {
      id: "nav-1",
      action: "navigate",
      params: { url: "https://example.com" },
    };
    expect(req.id).toBe("nav-1");
    expect(req.action).toBe("navigate");
    expect(req.params.url).toBe("https://example.com");
  });

  test("navigate — optional waitUntil and timeout", () => {
    const req: Request<"navigate"> = {
      id: "nav-2",
      action: "navigate",
      params: {
        url: "https://example.com",
        waitUntil: "networkidle",
        timeout: 5000,
      },
    };
    expect(req.params.waitUntil).toBe("networkidle");
    expect(req.params.timeout).toBe(5000);
  });

  test("click — requires selector", () => {
    const req: Request<"click"> = {
      id: "clk-1",
      action: "click",
      params: { selector: ".submit-btn" },
    };
    expect(req.params.selector).toBe(".submit-btn");
  });

  test("click — optional text and timeout", () => {
    const req: Request<"click"> = {
      id: "clk-2",
      action: "click",
      params: {
        selector: "button",
        text: "Submit",
        timeout: 3000,
      },
    };
    expect(req.params.text).toBe("Submit");
    expect(req.params.timeout).toBe(3000);
  });

  test("type — requires selector and text", () => {
    const req: Request<"type"> = {
      id: "typ-1",
      action: "type",
      params: { selector: "input", text: "hello" },
    };
    expect(req.params.selector).toBe("input");
    expect(req.params.text).toBe("hello");
  });

  test("type — optional clear and submit", () => {
    const req: Request<"type"> = {
      id: "typ-2",
      action: "type",
      params: {
        selector: "textarea",
        text: "world",
        clear: true,
        submit: true,
      },
    };
    expect(req.params.clear).toBe(true);
    expect(req.params.submit).toBe(true);
  });

  test("screenshot — optional format, quality, fullPage", () => {
    const req: Request<"screenshot"> = {
      id: "ss-1",
      action: "screenshot",
      params: { format: "jpeg", quality: 90, fullPage: true },
    };
    expect(req.params.format).toBe("jpeg");
    expect(req.params.quality).toBe(90);
    expect(req.params.fullPage).toBe(true);
  });

  test("screenshot — empty params object is valid", () => {
    const req: Request<"screenshot"> = {
      id: "ss-2",
      action: "screenshot",
      params: {},
    };
    expect(req.params).toEqual({});
  });

  test("read — no required fields", () => {
    const req: Request<"read"> = {
      id: "rd-1",
      action: "read",
      params: {},
    };
    expect(req.params).toEqual({});
  });

  test("read — optional selector and maxLength", () => {
    const req: Request<"read"> = {
      id: "rd-2",
      action: "read",
      params: { selector: "main", maxLength: 2000 },
    };
    expect(req.params.selector).toBe("main");
    expect(req.params.maxLength).toBe(2000);
  });

  test("exec — requires code", () => {
    const req: Request<"exec"> = {
      id: "exe-1",
      action: "exec",
      params: { code: "document.title" },
    };
    expect(req.params.code).toBe("document.title");
  });

  test("generic Request (untyped action) is constructable", () => {
    const req: Request = {
      id: "gen-1",
      action: "navigate",
      params: { url: "https://example.com" },
    };
    expect(req.id).toBe("gen-1");
    expect(req.action).toBe("navigate");
    // params is NavigateParams | ClickParams | ... — runtime shape is an object
    expect(typeof req.params).toBe("object");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Response type
// ═══════════════════════════════════════════════════════════════════════════

describe("Response", () => {
  test("success response carries result", () => {
    const res: Response<"navigate"> = {
      id: "nav-1",
      result: { url: "https://example.com", title: "Example Domain" },
    };
    expect(res.id).toBe("nav-1");
    expect(res.result).toBeDefined();
    expect(res.error).toBeUndefined();
  });

  test("error response carries error (no result)", () => {
    const res: Response<"click"> = {
      id: "clk-1",
      error: {
        code: "ELEMENT_NOT_FOUND",
        message: "No element matching '.missing' was found",
      },
    };
    expect(res.id).toBe("clk-1");
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe("ELEMENT_NOT_FOUND");
    expect(res.result).toBeUndefined();
  });

  test("error response with suggestion", () => {
    const res: Response<"type"> = {
      id: "typ-1",
      error: {
        code: "ELEMENT_NOT_TYPABLE",
        message: "Element is not typable",
        suggestion: "Use a selector targeting an input, textarea, or contenteditable element",
      },
    };
    expect(res.error!.suggestion).toContain("input");
  });

  test("every error code can be carried in a response", () => {
    const codes: ErrorCode[] = [
      "TIMEOUT",
      "ELEMENT_NOT_FOUND",
      "ELEMENT_NOT_INTERACTABLE",
      "ELEMENT_NOT_TYPABLE",
      "INVALID_URL",
      "RESTRICTED_URL",
      "RESTRICTED_DOMAIN",
      "BROWSER_NOT_CONNECTED",
      "UNKNOWN_ACTION",
      "TAB_NOT_FOUND",
    ];
    for (const code of codes) {
      const res: Response = {
        id: "test",
        error: { code, message: `Error: ${code}` },
      };
      expect(res.error!.code).toBe(code);
    }
  });

  test("response id matches request id for correlation", () => {
    const requestId = "req-42";
    const res: Response = { id: requestId, result: {} };
    expect(res.id).toBe(requestId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ActionParams mapping
// ═══════════════════════════════════════════════════════════════════════════

describe("ActionParams mapped type", () => {
  test("NavigateParams shape", () => {
    const p: ActionParams["navigate"] = {
      url: "https://example.com",
      waitUntil: "load",
      timeout: 10000,
    };
    expect(p.url).toBe("https://example.com");
    expect(p.waitUntil).toBe("load");
    expect(p.timeout).toBe(10000);
  });

  test("ClickParams shape", () => {
    const p: ActionParams["click"] = {
      selector: ".btn",
      text: "Click me",
      timeout: 5000,
    };
    expect(p.selector).toBe(".btn");
    expect(p.text).toBe("Click me");
  });

  test("TypeParams shape", () => {
    const p: ActionParams["type"] = {
      selector: "#email",
      text: "user@example.com",
      clear: true,
      submit: false,
      timeout: 10000,
    };
    expect(p.selector).toBe("#email");
    expect(p.clear).toBe(true);
    expect(p.submit).toBe(false);
  });

  test("ScreenshotParams shape", () => {
    const p: ActionParams["screenshot"] = {
      format: "jpeg",
      quality: 75,
      fullPage: false,
    };
    expect(p.format).toBe("jpeg");
    expect(p.quality).toBe(75);
    expect(p.fullPage).toBe(false);
  });

  test("ReadParams shape", () => {
    const p: ActionParams["read"] = {
      selector: "article",
      maxLength: 5000,
    };
    expect(p.selector).toBe("article");
    expect(p.maxLength).toBe(5000);
  });

  test("ExecParams shape", () => {
    const p: ActionParams["exec"] = {
      code: "document.querySelector('h1').textContent",
    };
    expect(p.code).toContain("h1");
  });

  test("ActionParams maps every action to its correct params interface", () => {
    // Verify the mapping keys match the Action union
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

    // For each action, the mapped params type should be constructable
    const examples: Record<Action, ActionParams[Action]> = {
      navigate: { url: "https://example.com" },
      click: { selector: "#btn" },
      type: { selector: "input", text: "hi" },
      screenshot: {},
      read: {},
      exec: { code: "1 + 1" },
      waitForElement: { selector: ".modal" },
      waitForText: { text: "Welcome" },
      createTab: {},
      listTabs: {},
      closeTab: { tabId: 1 },
    };

    for (const action of actions) {
      expect(examples[action]).toBeDefined();
      expect(typeof examples[action]).toBe("object");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// tabId parameter on action params
// ═══════════════════════════════════════════════════════════════════════════

describe("tabId parameter on action params", () => {
  test("NavigateParams accepts optional tabId", () => {
    const withoutTabId: NavigateParams = { url: "https://example.com" };
    expect(withoutTabId.tabId).toBeUndefined();

    const withTabId: NavigateParams = { url: "https://example.com", tabId: 42 };
    expect(withTabId.tabId).toBe(42);
  });

  test("ClickParams accepts optional tabId", () => {
    const withoutTabId: ClickParams = { selector: "#btn" };
    expect(withoutTabId.tabId).toBeUndefined();

    const withTabId: ClickParams = { selector: "#btn", tabId: 7 };
    expect(withTabId.tabId).toBe(7);
  });

  test("TypeParams accepts optional tabId", () => {
    const withoutTabId: TypeParams = { selector: "input", text: "hello" };
    expect(withoutTabId.tabId).toBeUndefined();

    const withTabId: TypeParams = { selector: "input", text: "hello", tabId: 3 };
    expect(withTabId.tabId).toBe(3);
  });

  test("ReadParams accepts optional tabId", () => {
    const withoutTabId: ReadParams = {};
    expect(withoutTabId.tabId).toBeUndefined();

    const withTabId: ReadParams = { tabId: 15, selector: "main" };
    expect(withTabId.tabId).toBe(15);
  });

  test("ScreenshotParams accepts optional tabId", () => {
    const withoutTabId: ScreenshotParams = {};
    expect(withoutTabId.tabId).toBeUndefined();

    const withTabId: ScreenshotParams = { tabId: 99, format: "png" };
    expect(withTabId.tabId).toBe(99);
  });

  test("ExecParams accepts optional tabId", () => {
    const withoutTabId: ExecParams = { code: "1" };
    expect(withoutTabId.tabId).toBeUndefined();

    const withTabId: ExecParams = { code: "1", tabId: 5 };
    expect(withTabId.tabId).toBe(5);
  });

  test("WaitForElementParams accepts optional tabId", () => {
    const withoutTabId: WaitForElementParams = { selector: ".loader" };
    expect(withoutTabId.tabId).toBeUndefined();

    const withTabId: WaitForElementParams = { selector: ".loader", tabId: 21 };
    expect(withTabId.tabId).toBe(21);
  });

  test("WaitForTextParams accepts optional tabId", () => {
    const withoutTabId: WaitForTextParams = { text: "ready" };
    expect(withoutTabId.tabId).toBeUndefined();

    const withTabId: WaitForTextParams = { text: "ready", tabId: 8 };
    expect(withTabId.tabId).toBe(8);
  });

  test("CloseTabParams requires tabId (mandatory, not optional)", () => {
    const params: CloseTabParams = { tabId: 42 };
    expect(params.tabId).toBe(42);
  });

  test("CreateTabParams has no tabId — tab does not exist yet", () => {
    const params: CreateTabParams = { url: "https://example.com" };
    expect("tabId" in params).toBe(false);
  });

  test("ListTabsParams has no tabId — listing all tabs", () => {
    const params: ListTabsParams = { currentWindowOnly: true };
    expect("tabId" in params).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// New action types: createTab, listTabs, closeTab
// ═══════════════════════════════════════════════════════════════════════════

describe("New action types — createTab, listTabs, closeTab", () => {
  test("createTab is a valid Action", () => {
    const action: Action = "createTab";
    expect(action).toBe("createTab");
  });

  test("listTabs is a valid Action", () => {
    const action: Action = "listTabs";
    expect(action).toBe("listTabs");
  });

  test("closeTab is a valid Action", () => {
    const action: Action = "closeTab";
    expect(action).toBe("closeTab");
  });

  test("createTab request can be constructed without params", () => {
    const req: Request<"createTab"> = {
      id: "tab-new-1",
      action: "createTab",
      params: {},
    };
    expect(req.action).toBe("createTab");
    expect(req.params).toEqual({});
  });

  test("createTab request can include url and active", () => {
    const req: Request<"createTab"> = {
      id: "tab-new-2",
      action: "createTab",
      params: { url: "https://example.com", active: false },
    };
    expect(req.params.url).toBe("https://example.com");
    expect(req.params.active).toBe(false);
  });

  test("listTabs request can be constructed with empty params", () => {
    const req: Request<"listTabs"> = {
      id: "tab-list-1",
      action: "listTabs",
      params: {},
    };
    expect(req.action).toBe("listTabs");
  });

  test("listTabs request can include urlPattern", () => {
    const req: Request<"listTabs"> = {
      id: "tab-list-2",
      action: "listTabs",
      params: { urlPattern: "github.com", currentWindowOnly: true },
    };
    expect(req.params.urlPattern).toBe("github.com");
    expect(req.params.currentWindowOnly).toBe(true);
  });

  test("closeTab request requires tabId", () => {
    const req: Request<"closeTab"> = {
      id: "tab-close-1",
      action: "closeTab",
      params: { tabId: 42 },
    };
    expect(req.action).toBe("closeTab");
    expect(req.params.tabId).toBe(42);
  });

  test("closeTab response carries tabId in result", () => {
    const res: Response<"closeTab"> = {
      id: "tab-close-1",
      result: { tabId: 42, closed: true },
    };
    expect(res.result).toBeDefined();
  });

  test("createTab response carries new tab descriptor", () => {
    const res: Response<"createTab"> = {
      id: "tab-new-1",
      result: { tabId: 99, url: "https://example.com", title: "Example" },
    };
    expect(res.result).toBeDefined();
  });

  test("listTabs response carries array of tab descriptors", () => {
    const res: Response<"listTabs"> = {
      id: "tab-list-1",
      result: [
        { tabId: 1, url: "https://a.com", title: "A", active: true },
        { tabId: 2, url: "https://b.com", title: "B", active: false },
      ],
    };
    expect(res.result).toBeDefined();
    expect(Array.isArray(res.result)).toBe(true);
  });

  test("all new actions are constructable as generic Request", () => {
    const createTabReq: Request = {
      id: "g1", action: "createTab", params: {},
    };
    const listTabsReq: Request = {
      id: "g2", action: "listTabs", params: {},
    };
    const closeTabReq: Request = {
      id: "g3", action: "closeTab", params: { tabId: 1 },
    };
    expect(createTabReq.action).toBe("createTab");
    expect(listTabsReq.action).toBe("listTabs");
    expect(closeTabReq.action).toBe("closeTab");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TAB_NOT_FOUND error response shapes
// ═══════════════════════════════════════════════════════════════════════════

describe("TAB_NOT_FOUND error response shapes", () => {
  test("minimal TAB_NOT_FOUND error — code and message only", () => {
    const err: ErrorResponse = {
      code: "TAB_NOT_FOUND",
      message: "Tab 42 was not found",
    };
    expect(err.code).toBe("TAB_NOT_FOUND");
    expect(err.message).toBe("Tab 42 was not found");
    expect(err.suggestion).toBeUndefined();
  });

  test("TAB_NOT_FOUND error with suggestion", () => {
    const err: ErrorResponse = {
      code: "TAB_NOT_FOUND",
      message: "Tab 42 does not correspond to any open tab",
      suggestion: "The tab may have been closed. List tabs to find a valid TabId.",
    };
    expect(err.code).toBe("TAB_NOT_FOUND");
    expect(err.suggestion).toContain("List tabs");
  });

  test("TAB_NOT_FOUND can be carried in a Response", () => {
    const res: Response = {
      id: "nav-42",
      error: {
        code: "TAB_NOT_FOUND",
        message: "Tab 42 was closed before the request completed",
        suggestion: "Create a new tab and navigate again.",
      },
    };
    expect(res.id).toBe("nav-42");
    expect(res.error!.code).toBe("TAB_NOT_FOUND");
    expect(res.error!.message).toContain("closed");
    expect(res.error!.suggestion).toContain("Create a new tab");
    expect(res.result).toBeUndefined();
  });

  test("TAB_NOT_FOUND error for click action on closed tab", () => {
    const res: Response<"click"> = {
      id: "clk-1",
      error: {
        code: "TAB_NOT_FOUND",
        message: "Cannot click: tab 7 no longer exists",
      },
    };
    expect(res.error!.code).toBe("TAB_NOT_FOUND");
    expect(res.result).toBeUndefined();
  });

  test("TAB_NOT_FOUND error for type action on closed tab", () => {
    const res: Response<"type"> = {
      id: "typ-1",
      error: {
        code: "TAB_NOT_FOUND",
        message: "Cannot type: tab 3 was closed",
        suggestion: "Use listTabs to find a valid tab, or createTab to open a new one.",
      },
    };
    expect(res.error!.code).toBe("TAB_NOT_FOUND");
    expect(res.error!.suggestion).toContain("listTabs");
  });

  test("TAB_NOT_FOUND error for read action on closed tab", () => {
    const res: Response<"read"> = {
      id: "rd-1",
      error: {
        code: "TAB_NOT_FOUND",
        message: "Cannot read: tab 5 was closed",
      },
    };
    expect(res.error!.code).toBe("TAB_NOT_FOUND");
  });

  test("TAB_NOT_FOUND error for closeTab on already-closed tab", () => {
    const res: Response<"closeTab"> = {
      id: "close-1",
      error: {
        code: "TAB_NOT_FOUND",
        message: "Tab 99 does not exist",
        suggestion: "The tab may have been closed by another action. List tabs to find valid tabIds.",
      },
    };
    expect(res.error!.code).toBe("TAB_NOT_FOUND");
    expect(res.result).toBeUndefined();
  });

  test("TAB_NOT_FOUND error is distinguishable from BROWSER_NOT_CONNECTED", () => {
    const tabNotFound: ErrorResponse = {
      code: "TAB_NOT_FOUND",
      message: "Tab 42 not found",
    };
    const browserNotConnected: ErrorResponse = {
      code: "BROWSER_NOT_CONNECTED",
      message: "No Chrome extension is connected",
    };
    expect(tabNotFound.code).not.toBe(browserNotConnected.code);
    expect(tabNotFound.code).toBe("TAB_NOT_FOUND");
    expect(browserNotConnected.code).toBe("BROWSER_NOT_CONNECTED");
  });

  test("TAB_NOT_FOUND error shape matches ErrorResponse interface exactly", () => {
    const err: ErrorResponse = {
      code: "TAB_NOT_FOUND",
      message: "Tab was closed",
      suggestion: "Re-open the tab",
    };
    // Verify every field is typed correctly
    expect(typeof err.code).toBe("string");
    expect(typeof err.message).toBe("string");
    expect(typeof err.suggestion).toBe("string");
    expect(err.code).toMatch(/^[A-Z_]+$/);
  });
});
