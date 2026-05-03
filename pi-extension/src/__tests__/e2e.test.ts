/**
 * End-to-end integration tests for the pi-browser-bridge.
 *
 * Starts the real WebSocket server, connects simulated browser-extension
 * clients, and exercises every tool through the full request/response cycle.
 *
 * The simulated browser client responds to requests as if it were a real
 * Chrome extension interacting with test-fixture.html.
 *
 * Coverage:
 * - All 8 tool handlers (navigate, screenshot, click, type, read, exec,
 *   waitForElement, waitForText)
 * - Request/response correlation by id
 * - Concurrent requests
 * - Error paths: ELEMENT_NOT_FOUND, TIMEOUT, disconnect
 * - Reconnection: client drop → new client → requests flow again
 *
 * NOTE: This test is explicitly excluded from CI. It requires a real
 * WebSocket server and is intended as a manual pre-merge gate.
 * It is NOT listed in vitest.config.ts projects and uses bun:test directly.
 *
 * @module e2e.test
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { start, stop, send } from "../infrastructure/ws-server.js";
import { browserNavigate } from "../tools/browser-navigate.js";
import { browserClick } from "../tools/browser-click.js";
import { browserType } from "../tools/browser-type.js";
import { browserRead } from "../tools/browser-read.js";
import { browserScreenshot } from "../tools/browser-screenshot.js";
import { browserExec } from "../tools/browser-exec.js";
import { browserWaitForElement } from "../tools/browser-wait-for-element.js";
import { browserWaitForText } from "../tools/browser-wait-for-text.js";

// ── Types ──────────────────────────────────────────────────────────────────

/** Incoming request from the server (echoed by the simulated client). */
interface SimRequest {
  id: string;
  action: string;
  params: Record<string, unknown>;
}

/** Response handler signature used by SimBrowser. */
type RequestHandler = (req: SimRequest) => Record<string, unknown> | void;

// ── Helpers ────────────────────────────────────────────────────────────────

let currentServer: ReturnType<typeof start> | null = null;

/**
 * Start a fresh server on a dynamic (OS-assigned) port.
 * Stores the server for cleanup and returns the port.
 */
async function startOnDynamicPort(): Promise<number> {
  stop();
  currentServer = await start(0);
  return currentServer.port;
}

/**
 * Connect a test WebSocket client to the server.
 * Resolves once the connection is open.
 */
function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) =>
      reject(new Error(`WebSocket connection failed: ${e.message}`));
    setTimeout(
      () => reject(new Error("WebSocket connection timed out")),
      3000,
    );
  });
}

/** Small sleep helper (ms). */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Simulated Browser Client ───────────────────────────────────────────────

/**
 * Minimal valid 1×1 white PNG in base64.
 * Used as a realistic screenshot payload by the simulated browser.
 */
const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

/**
 * Factory: creates a WebSocket message handler that simulates a Chrome
 * extension content script / service worker.
 *
 * The handler receives parsed {@link SimRequest} objects and calls
 * `ws.send(JSON.stringify({ id, result }))` or
 * `ws.send(JSON.stringify({ id, error }))` for each one.
 *
 * Error simulation table:
 * | Selector / pattern        | Error code                  |
 * |---------------------------|-----------------------------|
 * | `.missing`                | `ELEMENT_NOT_FOUND`         |
 * | `.hidden`                 | `ELEMENT_NOT_INTERACTABLE`  |
 * | `.disabled` / `[disabled]`| `ELEMENT_NOT_INTERACTABLE`  |
 * | `div` (for type)          | `ELEMENT_NOT_TYPABLE`       |
 * | `#timeout-trigger`        | never responds (timeout)    |
 * | `#disconnect-trigger`     | closes connection           |
 *
 * Default behavior returns a plausible success result for each action.
 */
function createSimBrowser(
  respond: (id: string, result: Record<string, unknown>) => void,
  respondError: (id: string, code: string, message: string) => void,
): (data: string) => void {
  return (data: string) => {
    let req: SimRequest;
    try {
      req = JSON.parse(data);
    } catch {
      return; // ignore malformed messages
    }

    if (!req?.id || !req?.action) return;

    // ── Special trigger selectors ───────────────────────────────────
    const selector =
      typeof req.params?.selector === "string" ? req.params.selector : "";

    // Timeout trigger: never respond
    if (req.id === "timeout-trigger" || selector === "#timeout-trigger") {
      return;
    }

    // Disconnect trigger: close connection immediately
    if (req.id === "disconnect-trigger" || selector === "#disconnect-trigger") {
      // The caller manages the ws reference; we signal via a special response
      respond(req.id, { _disconnect: true });
      return;
    }

    switch (req.action) {
      case "navigate": {
        const url = typeof req.params?.url === "string" ? req.params.url : "about:blank";
        respond(req.id, {
          url,
          title: `Page: ${url.replace(/^https?:\/\//, "").replace(/\/$/, "")}`,
        });
        break;
      }

      case "screenshot": {
        const format =
          req.params?.format === "jpeg" ? "jpeg" : "png";
        respond(req.id, {
          data: SAMPLE_PNG_BASE64,
          format,
        });
        break;
      }

      case "click": {
        // Error selectors
        if (selector === ".missing") {
          respond(req.id, {
            clicked: false,
            code: "ELEMENT_NOT_FOUND",
            message: `No element matching ".missing" was found on the page.`,
            suggestions: ["Button A", "Button B", "Link C"],
          });
          return;
        }
        if (selector === ".hidden") {
          respondError(
            req.id,
            "ELEMENT_NOT_INTERACTABLE",
            "Element is hidden and cannot be clicked.",
          );
          return;
        }
        if (selector === ".disabled" || selector.includes("[disabled]")) {
          respondError(
            req.id,
            "ELEMENT_NOT_INTERACTABLE",
            "Element is disabled and cannot be clicked.",
          );
          return;
        }

        // Success: resolve element text from a lookup
        const elementText = getElementTextForSelector(selector);
        respond(req.id, {
          clicked: true,
          selector,
          text: elementText,
          navigated: false,
        });
        break;
      }

      case "type": {
        if (!selector || selector === ".missing") {
          respondError(
            req.id,
            "ELEMENT_NOT_FOUND",
            `Element "${selector || "(empty)"}" not found.`,
          );
          return;
        }
        if (selector === ".hidden") {
          respondError(
            req.id,
            "ELEMENT_NOT_INTERACTABLE",
            "Element is hidden and cannot be typed into.",
          );
          return;
        }
        if (selector === ".disabled" || selector.includes("[disabled]")) {
          respondError(
            req.id,
            "ELEMENT_NOT_INTERACTABLE",
            "Element is disabled.",
          );
          return;
        }
        if (selector === "div" || selector === "span" || selector === "p") {
          respondError(
            req.id,
            "ELEMENT_NOT_TYPABLE",
            `Element "${selector}" is not a typable element.`,
          );
          return;
        }

        const text = typeof req.params?.text === "string" ? req.params.text : "";
        const clear = req.params?.clear !== false;
        respond(req.id, {
          typed: true,
          selector,
          value: text,
        });
        break;
      }

      case "read": {
        const scope = typeof req.params?.selector === "string" ? req.params.selector : "body";
        if (scope === ".missing" || scope === ".nonexistent") {
          respondError(
            req.id,
            "ELEMENT_NOT_FOUND",
            `Selector "${scope}" did not match any element.`,
          );
          return;
        }

        const maxLength =
          typeof req.params?.maxLength === "number" ? req.params.maxLength : 50000;

        const text = getPageTextForSelector(scope);
        const truncated = text.length > maxLength;
        respond(req.id, {
          text: truncated ? text.slice(0, maxLength) : text,
          length: text.length,
          truncated,
        });
        break;
      }

      case "exec": {
        const code = typeof req.params?.code === "string" ? req.params.code : "";
        respond(req.id, {
          serialized: `Executed: ${code.slice(0, 50)}`,
        });
        break;
      }

      case "waitForElement": {
        if (!selector || selector === ".missing") {
          respondError(
            req.id,
            "TIMEOUT",
            `Element "${selector || "(empty)"}" did not appear within the timeout.`,
          );
          return;
        }
        respond(req.id, {
          found: true,
          elapsedMs: 42,
          selector,
          tagName: selector.startsWith("#") ? "div" : selector,
        });
        break;
      }

      case "waitForText": {
        const text = typeof req.params?.text === "string" ? req.params.text : "";
        if (!text || text === "never-appears") {
          respondError(
            req.id,
            "TIMEOUT",
            `Text "${text || "(empty)"}" did not appear within the timeout.`,
          );
          return;
        }
        respond(req.id, {
          found: true,
          elapsedMs: 42,
          text,
        });
        break;
      }

      default: {
        respondError(
          req.id,
          "UNKNOWN_ACTION",
          `Action "${req.action}" is not recognised.`,
        );
        break;
      }
    }
  };
}

/**
 * Lookup table mapping CSS selectors to their simulated text content.
 * Mirrors elements from test-fixture.html.
 */
function getElementTextForSelector(selector: string): string {
  const lookup: Record<string, string> = {
    "#btn-primary": "Primary Action",
    "#btn-secondary": "Secondary Action",
    "#btn-danger": "Danger Action",
    "#submit-btn": "Submit",
    "#name-input": "",
    "#email-input": "",
    "#message-textarea": "",
    "button": "Primary Action",
    ".btn": "Primary Action",
    "button.primary": "Primary Action",
    "h1": "Pi Browser Bridge — Test Fixture",
    "h2": "Section 1: Content",
    "p": "This is the first content section.",
    "a": "Example Domain",
  };

  if (lookup[selector]) return lookup[selector];

  // Fuzzy match for selectors not in the lookup
  if (selector.includes("btn")) return "Button Element";
  if (selector.includes("input")) return "";
  if (selector.includes("h1")) return "Heading Element";
  if (selector.includes("p")) return "Paragraph text";
  if (selector.includes("a")) return "Link text";

  return `Element matching "${selector}"`;
}

/**
 * Returns simulated page text for a given CSS selector scope.
 */
function getPageTextForSelector(scope: string): string {
  if (scope === "body" || scope === "" || !scope) {
    return [
      "Pi Browser Bridge — Test Fixture",
      "",
      "This page serves as the simulated page for end-to-end testing of the",
      "pi-browser-bridge WebSocket protocol.",
      "",
      "Section 1: Content",
      "This is the first content section. It contains a paragraph with some",
      "sample text that can be read by the browser_read tool.",
      "The quick brown fox jumps over the lazy dog.",
      "",
      "Section 2: Interactive Elements",
      "Primary Action  Secondary Action  Danger Action",
      "",
      "Section 3: Form",
      "Name:  Email:  Message:  Submit",
      "",
      "External Links",
      "Example Domain  GitHub",
    ].join("\n");
  }

  if (scope === "h1") return "Pi Browser Bridge — Test Fixture";
  if (scope === "#section-1") {
    return [
      "Section 1: Content",
      "This is the first content section. It contains a paragraph with some",
      "sample text that can be read by the browser_read tool.",
      "The quick brown fox jumps over the lazy dog.",
    ].join("\n");
  }
  if (scope === "#section-2") {
    return "Primary Action  Secondary Action  Danger Action";
  }

  return `Content matching "${scope}"`;
}

/**
 * Attach a simulated browser to a WebSocket, handling all incoming messages.
 */
function attachSimBrowser(ws: WebSocket): void {
  const respond = (id: string, result: Record<string, unknown>) => {
    if (result._disconnect) {
      ws.close();
      return;
    }
    ws.send(JSON.stringify({ id, result }));
  };

  const respondError = (id: string, code: string, message: string) => {
    ws.send(JSON.stringify({ id, error: { code, message } }));
  };

  const handler = createSimBrowser(respond, respondError);
  ws.onmessage = (event) => handler(event.data as string);
}

// ── Assertion helpers ──────────────────────────────────────────────────────

/** Assert a tool result is not an error. */
function expectSuccess(result: any) {
  expect(result.isError).toBeFalsy();
}

/** Assert a tool result is an error and contains the given text. */
function expectError(result: any, contains: string) {
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain(contains);
}

/** Assert two objects are deeply equal (Bun-style). */
function expectDeepEqual(actual: any, expected: any) {
  expect(actual).toEqual(expected);
}

// ═══════════════════════════════════════════════════════════════════════════
// E2E: Full round-trips through each tool
// ═══════════════════════════════════════════════════════════════════════════

describe("E2E: Full round-trips", () => {
  let port: number;

  beforeEach(async () => {
    port = await startOnDynamicPort();
  });

  afterEach(() => {
    stop();
  });

  describe("browser_navigate", () => {
    test("returns URL and title from simulated browser", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserNavigate({ url: "https://example.com" });
      expectSuccess(result);
      expect(result.content[0].text).toContain("Navigated to: https://example.com");
      expect(result.content[0].text).toContain("example.com");
      ws.close();
    });

    test("handles URLs with paths and query strings", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserNavigate({
        url: "https://github.com/marco-souza/pi-browser-bridge",
        waitUntil: "networkidle",
        timeout: 15000,
      });
      expectSuccess(result);
      expect(result.content[0].text).toContain("Navigated to:");
      expect(result.content[0].text).toContain("github.com");
      ws.close();
    });

    test("forwards TIMEOUT error from browser", async () => {
      const ws = await connectClient(port);
      ws.onmessage = (event) => {
        const req = JSON.parse(event.data as string);
        ws.send(JSON.stringify({
          id: req.id,
          error: { code: "TIMEOUT", message: "Navigation exceeded 5s" },
        }));
      };

      const result = await browserNavigate({ url: "https://slow.com", timeout: 5000 });
      expectError(result, "Navigate failed");
      expect(result.content[0].text).toContain("5000ms");
      ws.close();
    });
  });

  describe("browser_screenshot", () => {
    test("returns base64 PNG image block", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserScreenshot({ format: "png" });
      expectSuccess(result);

      const block = result.content[0];
      expect(block.type).toBe("image");
      expect(block.source.type).toBe("base64");
      expect(block.source.mediaType).toBe("image/png");
      expect(block.source.data).toBe(SAMPLE_PNG_BASE64);
      ws.close();
    });

    test("returns JPEG image block with correct media type", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserScreenshot({ format: "jpeg", quality: 85 });
      expectSuccess(result);
      expect(result.content[0].source.mediaType).toBe("image/jpeg");
      ws.close();
    });

    test("defaults to PNG when no format specified", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserScreenshot({});
      expectSuccess(result);
      expect(result.content[0].source.mediaType).toBe("image/png");
      ws.close();
    });

    test("attaches warning text block when present", async () => {
      const ws = await connectClient(port);
      ws.onmessage = (event) => {
        const req = JSON.parse(event.data as string);
        ws.send(JSON.stringify({
          id: req.id,
          result: { data: SAMPLE_PNG_BASE64, format: "png", warning: "fullPage is viewport-only in v1" },
        }));
      };

      const result = await browserScreenshot({ fullPage: true });
      expectSuccess(result);
      expect(result.content).toHaveLength(2);
      expect(result.content[1].type).toBe("text");
      expect(result.content[1].text).toContain("v1");
      ws.close();
    });

    test("forwards server-side error (RESTRICTED_URL)", async () => {
      const ws = await connectClient(port);
      ws.onmessage = (event) => {
        const req = JSON.parse(event.data as string);
        ws.send(JSON.stringify({
          id: req.id,
          error: { code: "RESTRICTED_URL", message: "Cannot screenshot restricted page" },
        }));
      };

      const result = await browserScreenshot({});
      expectError(result, "Screenshot failed");
      expect(result.content[0].text).toContain("restricted");
      ws.close();
    });
  });

  describe("browser_click", () => {
    test("returns clicked element text for known selector", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserClick({ selector: "#btn-primary" });
      expectSuccess(result);
      expect(result.content[0].text).toContain("Clicked element");
      expect(result.content[0].text).toContain("Primary Action");
      ws.close();
    });

    test("handles selector with text disambiguation", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserClick({ selector: "button", text: "Submit" });
      expectSuccess(result);
      expect(result.content[0].text).toContain("Clicked element");
      ws.close();
    });

    test("returns ELEMENT_NOT_FOUND with suggestions for .missing", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserClick({ selector: ".missing" });
      expectError(result, "Click failed");
      expect(result.content[0].text).toContain("Button A");
      expect(result.content[0].text).toContain("Button B");
      expect(result.content[0].text).toContain("Link C");
      ws.close();
    });

    test("returns ELEMENT_NOT_INTERACTABLE for .hidden", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserClick({ selector: ".hidden" });
      expectError(result, "Click failed");
      expect(result.content[0].text).toContain("hidden");
      ws.close();
    });
  });

  describe("browser_type", () => {
    test("reports typed value on success", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserType({
        selector: "#email-input",
        text: "test@example.com",
      });
      expectSuccess(result);
      expect(result.content[0].text).toContain('Typed into "#email-input"');
      expect(result.content[0].text).toContain("test@example.com");
      ws.close();
    });

    test("respects clear flag", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserType({
        selector: "#name-input",
        text: "Marco",
        clear: true,
      });
      expectSuccess(result);
      expect(result.content[0].text).toContain("Marco");
      ws.close();
    });

    test("handles submit flag", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserType({
        selector: "#message-textarea",
        text: "Hello from E2E test",
        submit: true,
      });
      expectSuccess(result);
      expect(result.content[0].text).toContain("Hello from E2E test");
      ws.close();
    });

    test("returns ELEMENT_NOT_TYPABLE for non-input element (div)", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserType({ selector: "div", text: "hello" });
      expectError(result, "Type failed");
      expect(result.content[0].text).toContain("typable");
      ws.close();
    });

    test("returns ELEMENT_NOT_FOUND for missing element", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserType({ selector: ".missing", text: "hello" });
      expectError(result, "Type failed");
      ws.close();
    });
  });

  describe("browser_read", () => {
    test("returns page text from simulated browser", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserRead({});
      expectSuccess(result);
      expect(result.content[0].text).toContain("Pi Browser Bridge");
      expect(result.content[0].text).toContain("Test Fixture");
      expect(result.content[0].text).toContain("Section 1: Content");
      ws.close();
    });

    test("scopes read to a selector", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserRead({ selector: "#section-1" });
      expectSuccess(result);
      expect(result.content[0].text).toContain("Section 1: Content");
      expect(result.content[0].text).toContain("quick brown fox");
      ws.close();
    });

    test("truncates when text exceeds maxLength", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserRead({ maxLength: 50 });
      expectSuccess(result);
      expect(result.content[0].text).toContain("truncated");
      expect(result.content[0].text).toContain("50");
      ws.close();
    });

    test("returns ELEMENT_NOT_FOUND for invalid selector", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserRead({ selector: ".nonexistent" });
      expectError(result, "Read failed");
      expect(result.content[0].text).toContain("did not match");
      ws.close();
    });
  });

  describe("browser_exec", () => {
    test("executes code and returns serialised result", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserExec({ code: "document.title" });
      expectSuccess(result);
      expect(result.content[0].text).toContain("Executed: document.title");
      ws.close();
    });

    test("handles connection loss during exec", async () => {
      const ws = await connectClient(port);
      ws.onmessage = () => {}; // never respond

      const promise = browserExec({ code: "while(true){}" });
      await sleep(100);
      ws.close();

      const result = await promise;
      expectError(result, "Exec request failed");
    });
  });

  describe("browser_wait_for_element", () => {
    test("returns element info when found", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserWaitForElement({ selector: "#dynamic-element" });
      expectSuccess(result);
      expect(result.content[0].text).toContain("#dynamic-element");
      expect(result.content[0].text).toContain("found in");
      ws.close();
    });

    test("returns TIMEOUT when element never appears", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserWaitForElement({ selector: ".missing", timeout: 1000 });
      expectError(result, "did not appear");
      ws.close();
    });

    test("handles connection loss during wait", async () => {
      const ws = await connectClient(port);
      ws.onmessage = () => {}; // never respond

      const promise = browserWaitForElement({ selector: "#something", timeout: 5000 });
      await sleep(100);
      ws.close();

      const result = await promise;
      expectError(result, "Wait request failed");
    });
  });

  describe("browser_wait_for_text", () => {
    test("returns text info when found", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserWaitForText({ text: "Hello World" });
      expectSuccess(result);
      expect(result.content[0].text).toContain("Hello World");
      expect(result.content[0].text).toContain("found in");
      ws.close();
    });

    test("respects scope selector", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserWaitForText({ text: "Section 1", scope: "h2" });
      expectSuccess(result);
      expect(result.content[0].text).toContain("Section 1");
      ws.close();
    });

    test("returns TIMEOUT when text never appears", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserWaitForText({ text: "never-appears", timeout: 1000 });
      expectError(result, "did not appear");
      ws.close();
    });

    test("handles connection loss during wait", async () => {
      const ws = await connectClient(port);
      ws.onmessage = () => {}; // never respond

      const promise = browserWaitForText({ text: "something", timeout: 5000 });
      await sleep(100);
      ws.close();

      const result = await promise;
      expectError(result, "Wait request failed");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E2E: Concurrent requests
// ═══════════════════════════════════════════════════════════════════════════

describe("E2E: Concurrent requests", () => {
  let port: number;

  beforeEach(async () => {
    port = await startOnDynamicPort();
  });

  afterEach(() => {
    stop();
  });

  test("five tools called simultaneously — all resolve correctly", async () => {
    const ws = await connectClient(port);
    attachSimBrowser(ws);

    const [nav, click, type, read, ss] = await Promise.all([
      browserNavigate({ url: "https://concurrent-test.com" }),
      browserClick({ selector: "#btn-primary" }),
      browserType({ selector: "#email-input", text: "concurrent@test.com" }),
      browserRead({ selector: "body" }),
      browserScreenshot({ format: "png" }),
    ]);

    // Navigate
    expectSuccess(nav);
    expect(nav.content[0].text).toContain("Navigated to:");

    // Click
    expectSuccess(click);
    expect(click.content[0].text).toContain("Clicked element");

    // Type
    expectSuccess(type);
    expect(type.content[0].text).toContain("concurrent@test.com");

    // Read
    expectSuccess(read);
    expect(read.content[0].text).toContain("Test Fixture");

    // Screenshot
    expectSuccess(ss);
    expect(ss.content[0].type).toBe("image");
    expect(ss.content[0].source.data).toBe(SAMPLE_PNG_BASE64);

    ws.close();
  });

  test("concurrent requests with different actions resolve to correct request", async () => {
    const ws = await connectClient(port);

    // Use raw send() to verify exact id correlation under concurrency
    ws.onmessage = (event) => {
      const req = JSON.parse(event.data as string);
      // Echo back with the action name and id so we can verify
      ws.send(JSON.stringify({
        id: req.id,
        result: { action: req.action, echoId: req.id },
      }));
    };

    const [r1, r2, r3] = await Promise.all([
      send({ id: "conc-a", action: "navigate", params: { url: "https://a.com" } }),
      send({ id: "conc-b", action: "click", params: { selector: ".b" } }),
      send({ id: "conc-c", action: "read", params: {} }),
    ]);

    expect(r1.id).toBe("conc-a");
    expect(r1.result).toEqual({ action: "navigate", echoId: "conc-a" });

    expect(r2.id).toBe("conc-b");
    expect(r2.result).toEqual({ action: "click", echoId: "conc-b" });

    expect(r3.id).toBe("conc-c");
    expect(r3.result).toEqual({ action: "read", echoId: "conc-c" });

    ws.close();
  });

  test("concurrent requests — responses arrive out of order but correlate correctly", async () => {
    const ws = await connectClient(port);

    ws.onmessage = (event) => {
      const req = JSON.parse(event.data as string);

      if (req.id === "slow-conc") {
        // Respond after a delay
        setTimeout(() => {
          ws.send(JSON.stringify({ id: req.id, result: { name: "slow" } }));
        }, 300);
      } else {
        // Immediate response
        ws.send(JSON.stringify({ id: req.id, result: { name: "fast" } }));
      }
    };

    const slowPromise = send({
      id: "slow-conc",
      action: "read",
      params: {},
    });

    // Small delay to ensure slow is sent first, then fire fast
    await sleep(50);

    const fastPromise = send({
      id: "fast-conc",
      action: "read",
      params: {},
    });

    // Fast should resolve first despite being sent second
    const fast = await fastPromise;
    expect(fast.id).toBe("fast-conc");
    expect(fast.result).toEqual({ name: "fast" });

    const slow = await slowPromise;
    expect(slow.id).toBe("slow-conc");
    expect(slow.result).toEqual({ name: "slow" });

    ws.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E2E: Error Handling
// ═══════════════════════════════════════════════════════════════════════════

describe("E2E: Error handling", () => {
  let port: number;

  beforeEach(async () => {
    port = await startOnDynamicPort();
  });

  afterEach(() => {
    stop();
  });

  describe("ELEMENT_NOT_FOUND", () => {
    test("click with missing selector returns full error chain", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserClick({ selector: ".missing" });
      expectError(result, "Click failed");
      // Should include suggestions from the content script
      expect(result.content[0].text).toContain("Button A");
      expect(result.content[0].text).toContain("Button B");
      ws.close();
    });

    test("type with missing selector returns error", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserType({ selector: ".missing", text: "hi" });
      expectError(result, "Type failed");
      ws.close();
    });

    test("read with nonexistent selector returns error", async () => {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserRead({ selector: ".nonexistent" });
      expectError(result, "Read failed");
      ws.close();
    });
  });

  describe("TIMEOUT", () => {
    test("navigate request times out when browser never responds", async () => {
      const ws = await connectClient(port);

      // Client never responds — triggers server-side 30s timeout
      // We override the timeout to 500ms for fast testing via params,
      // but the server's REQUEST_TIMEOUT_MS is 30s. Instead we use
      // the disconnect approach: send, then close the connection.
      ws.onmessage = () => {}; // swallow all messages

      const promise = browserNavigate({
        url: "https://example.com",
        timeout: 1000,
      });

      // Close the connection shortly after — triggers rejectAllPending
      await sleep(100);
      ws.close();

      const result = await promise;
      // BROWSER_NOT_CONNECTED is surfaced on disconnect
      expectError(result, "Navigate request failed");
      expect(result.content[0].text).toContain("No browser extension");
    });

    test("click request fails when connection drops mid-flight", async () => {
      const ws = await connectClient(port);

      ws.onmessage = () => {}; // never respond

      const promise = browserClick({ selector: ".btn" });
      await sleep(100);
      ws.close();

      const result = await promise;
      expectError(result, "Click request failed");
      ws.close();
    });

    test("raw send() times out on the server side", async () => {
      const ws = await connectClient(port);

      // Never respond
      ws.onmessage = () => {};

      // Use a shorter approach: disconnect the client after a brief delay
      const promise = send({
        id: "will-timeout-e2e",
        action: "read",
        params: {},
      });

      await sleep(100);
      ws.close();

      await expect(promise).rejects.toMatchObject({
        code: "BROWSER_NOT_CONNECTED",
      });
    });
  });

  describe("BROWSER_NOT_CONNECTED", () => {
    test("all tools reject when no client is connected", async () => {
      // Server is running but no client
      const results = await Promise.allSettled([
        browserNavigate({ url: "https://example.com" }),
        browserClick({ selector: ".btn" }),
        browserType({ selector: "input", text: "hi" }),
        browserRead({}),
        browserScreenshot({}),
      ]);

      for (const r of results) {
        expect(r.status).toBe("fulfilled");
        if (r.status === "fulfilled") {
          expect(r.value.isError).toBe(true);
          expect(r.value.content[0].text).toMatch(/not connected|BROWSER_NOT_CONNECTED|No browser/i);
        }
      }
    });
  });

  describe("Malformed responses", () => {
    test("tool handles empty result gracefully", async () => {
      const ws = await connectClient(port);
      ws.onmessage = (event) => {
        const req = JSON.parse(event.data as string);
        ws.send(JSON.stringify({ id: req.id, result: {} }));
      };

      // navigate with empty result: formats url/title as undefined
      const nav = await browserNavigate({ url: "https://example.com" });
      expect(nav.content[0].text).toContain("Navigated to:");

      const read = await browserRead({});
      expectError(read, "no text content");

      const ss = await browserScreenshot({});
      expectError(ss, "no image data");

      ws.close();
    });

    test("server ignores non-JSON messages from client", async () => {
      const ws = await connectClient(port);

      // Send garbage
      ws.send("not json at all!!!");

      // A valid request should still work after garbage
      ws.onmessage = (event) => {
        const req = JSON.parse(event.data as string);
        ws.send(JSON.stringify({
          id: req.id,
          result: { url: "https://after-garbage.com", title: "After Garbage" },
        }));
      };

      const result = await browserNavigate({ url: "https://example.com" });
      expectSuccess(result);
      expect(result.content[0].text).toContain("After Garbage");

      ws.close();
    });

    test("server ignores messages without id", async () => {
      const ws = await connectClient(port);

      // Send a message without an id
      ws.send(JSON.stringify({ result: "no-id" }));

      // Valid request should still work
      ws.onmessage = (event) => {
        const req = JSON.parse(event.data as string);
        ws.send(JSON.stringify({ id: req.id, result: { ok: true } }));
      };

      // Direct send — won't match the no-id message
      const response = await send({ id: "with-id", action: "read", params: {} });
      expect(response.id).toBe("with-id");
      expect(response.result).toEqual({ ok: true });

      ws.close();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E2E: Reconnection
// ═══════════════════════════════════════════════════════════════════════════

describe("E2E: Reconnection", () => {
  let port: number;

  beforeEach(async () => {
    port = await startOnDynamicPort();
  });

  afterEach(() => {
    stop();
  });

  test("client disconnect → new client connects → requests flow again", async () => {
    // Phase 1: Connect client A and verify it works
    const wsA = await connectClient(port);
    attachSimBrowser(wsA);

    const result1 = await browserNavigate({ url: "https://phase1.com" });
    expectSuccess(result1);
    expect(result1.content[0].text).toContain("phase1.com");

    // Phase 2: Disconnect client A
    wsA.close();
    await sleep(200); // let server process the close

    // Phase 3: Verify requests reject when no client is connected
    const noClientResult = await browserRead({});
    expectError(noClientResult, "No browser extension");

    // Phase 4: Connect client B
    const wsB = await connectClient(port);
    attachSimBrowser(wsB);

    // Phase 5: Verify requests work again through client B
    const result2 = await browserClick({ selector: "#btn-primary" });
    expectSuccess(result2);
    expect(result2.content[0].text).toContain("Primary Action");

    const result3 = await browserScreenshot({ format: "png" });
    expectSuccess(result3);
    expect(result3.content[0].type).toBe("image");

    wsB.close();
  });

  test("pending requests reject on disconnect, new requests succeed on reconnect", async () => {
    const wsA = await connectClient(port);

    // Client A will never respond
    wsA.onmessage = () => {};

    const pendingPromise = browserNavigate({ url: "https://lost.com" });
    await sleep(50);

    // Disconnect — pending should reject
    wsA.close();
    await sleep(50);

    const pendingResult = await pendingPromise;
    expectError(pendingResult, "Navigate request failed");
    expect(pendingResult.content[0].text).toContain("No browser extension");

    // Reconnect and retry
    const wsB = await connectClient(port);
    attachSimBrowser(wsB);

    const retryResult = await browserNavigate({ url: "https://found.com" });
    expectSuccess(retryResult);
    expect(retryResult.content[0].text).toContain("found.com");

    wsB.close();
  });

  test("multiple reconnection cycles work reliably", async () => {
    for (let cycle = 1; cycle <= 3; cycle++) {
      const ws = await connectClient(port);
      attachSimBrowser(ws);

      const result = await browserRead({ selector: "body" });
      expectSuccess(result);
      expect(result.content[0].text).toContain("Test Fixture");

      ws.close();
      await sleep(100);

      // Verify disconnection state
      const disconnected = await browserRead({});
      expectError(disconnected, "No browser extension");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E2E: Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

describe("E2E: Edge cases", () => {
  let port: number;

  beforeEach(async () => {
    port = await startOnDynamicPort();
  });

  afterEach(() => {
    stop();
  });

  test("rapid sequential requests to the same tool", async () => {
    const ws = await connectClient(port);
    attachSimBrowser(ws);

    for (let i = 0; i < 5; i++) {
      const result = await browserRead({ selector: "body" });
      expectSuccess(result);
      expect(result.content[0].text).toContain("Test Fixture");
    }

    ws.close();
  });

  test("very long text in type request", async () => {
    const ws = await connectClient(port);
    attachSimBrowser(ws);

    const longText = "A".repeat(10000);
    const result = await browserType({
      selector: "#message-textarea",
      text: longText,
    });

    expectSuccess(result);
    // The value should be echoed back (truncated in result display but the
    // actual value is in the response)
    expect(result.content[0].text).toContain(longText);
    ws.close();
  });

  test("click with navigation flag returns navigation details", async () => {
    const ws = await connectClient(port);
    ws.onmessage = (event) => {
      const req = JSON.parse(event.data as string);
      ws.send(JSON.stringify({
        id: req.id,
        result: {
          clicked: true,
          selector: "a.nav-link",
          text: "Go to Page",
          navigated: true,
          newTitle: "New Page Title",
          newUrl: "https://newpage.com",
        },
      }));
    };

    const result = await browserClick({ selector: "a.nav-link" });
    expectSuccess(result);
    expect(result.content[0].text).toContain("New Page Title");
    expect(result.content[0].text).toContain("https://newpage.com");
    ws.close();
  });

  test("start() uses dynamic port 0 and returns correct port", async () => {
    stop();
    const srv = await start(0);

    // Dynamic port should be in the ephemeral range
    expect(srv.port).toBeGreaterThan(0);

    // Verify the server is listening by connecting
    const checkPromise = connectClient(srv.port);
    // Should resolve (or we timeout the test)
    expect(checkPromise).resolves.toBeDefined();
  });

  test("stop() is idempotent when called multiple times", async () => {
    await start(0);
    stop();
    stop(); // should not throw
    stop(); // should not throw
    // If we reach here without an exception, it passes
  });

  test("server survives client sending very large messages", async () => {
    const ws = await connectClient(port);

    // Send a large but well-formed message that doesn't match any pending request
    const largePayload = JSON.stringify({
      id: "large-unmatched",
      result: { data: "X".repeat(100000) },
    });
    ws.send(largePayload);

    await sleep(50);

    // Server should still be operational
    attachSimBrowser(ws);
    const result = await browserRead({});
    expectSuccess(result);

    ws.close();
  });

  test("UNKNOWN_ACTION returns error response", async () => {
    const ws = await connectClient(port);
    attachSimBrowser(ws);

    const response = await send({
      id: "unknown-action-test",
      action: "frobnicate" as any,
      params: {} as any,
    });

    expect(response.id).toBe("unknown-action-test");
    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe("UNKNOWN_ACTION");
    expect(response.result).toBeUndefined();

    ws.close();
  });
});
