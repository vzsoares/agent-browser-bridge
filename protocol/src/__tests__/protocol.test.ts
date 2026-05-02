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
  ErrorCode,
  ErrorResponse,
  Request,
  Response,
} from "@pi-browser-bridge/protocol";

// ═══════════════════════════════════════════════════════════════════════════
// Action union
// ═══════════════════════════════════════════════════════════════════════════

describe("Action type", () => {
  test("membership — all six actions are recognised", () => {
    const actions: Action[] = [
      "navigate",
      "click",
      "type",
      "screenshot",
      "read",
      "exec",
    ];
    expect(actions).toHaveLength(6);
  });

  test("each action is a non-empty string literal", () => {
    const actions: Action[] = [
      "navigate",
      "click",
      "type",
      "screenshot",
      "read",
      "exec",
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
    ];
    const unique = new Set(actions);
    expect(unique.size).toBe(actions.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Error codes
// ═══════════════════════════════════════════════════════════════════════════

describe("ErrorCode type", () => {
  test("membership — all eight error codes are recognised", () => {
    const codes: ErrorCode[] = [
      "TIMEOUT",
      "ELEMENT_NOT_FOUND",
      "ELEMENT_NOT_INTERACTABLE",
      "ELEMENT_NOT_TYPABLE",
      "INVALID_URL",
      "RESTRICTED_URL",
      "BROWSER_NOT_CONNECTED",
      "CONNECTION_RESET",
      "UNKNOWN_ACTION",
    ];
    expect(codes).toHaveLength(9);
  });

  test("each code is a non-empty string", () => {
    const codes: ErrorCode[] = [
      "TIMEOUT",
      "ELEMENT_NOT_FOUND",
      "ELEMENT_NOT_INTERACTABLE",
      "ELEMENT_NOT_TYPABLE",
      "INVALID_URL",
      "RESTRICTED_URL",
      "BROWSER_NOT_CONNECTED",
      "CONNECTION_RESET",
      "UNKNOWN_ACTION",
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
      "BROWSER_NOT_CONNECTED",
      "CONNECTION_RESET",
      "UNKNOWN_ACTION",
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
      "BROWSER_NOT_CONNECTED",
      "CONNECTION_RESET",
      "UNKNOWN_ACTION",
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
      "BROWSER_NOT_CONNECTED",
      "UNKNOWN_ACTION",
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
    };

    for (const action of actions) {
      expect(examples[action]).toBeDefined();
      expect(typeof examples[action]).toBe("object");
    }
  });
});
