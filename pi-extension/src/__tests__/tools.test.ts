/**
 * Unit + integration tests for tool handlers.
 *
 * - Schema tests validate JSON Schema structure (no server needed).
 * - Validation tests verify parameter rejection (no server needed — validation
 *   rejects before calling send()).
 * - Error mapping & success tests use a real WebSocket server + test client
 *   that acts as the browser extension. This avoids mock.module isolation
 *   issues and exercises the full tool → send → WS → response pipeline.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  browserNavigate,
  browserClick,
  browserType,
  browserRead,
  browserScreenshot,
  BROWSER_NAVIGATE_SCHEMA,
  BROWSER_CLICK_SCHEMA,
  BROWSER_TYPE_SCHEMA,
  BROWSER_READ_SCHEMA,
  BROWSER_SCREENSHOT_SCHEMA,
} from "../index.js";
import { start, stop } from "../server.js";

// ── Integration helpers ────────────────────────────────────────────────────

/**
 * Start a fresh server + connect a test WebSocket client that acts as the
 * browser extension. The `handler` receives parsed requests and should call
 * `respond(result)` or `respondError(error)` on this (or any) connection.
 */
async function withServer(
  fn: (port: number, ws: WebSocket) => Promise<void> | void,
): Promise<void> {
  // Start on dynamic port
  const srv = await start(0);
  const port = srv.port;

  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const w = new WebSocket(`ws://localhost:${port}`);
    w.onopen = () => resolve(w);
    w.onerror = (e) => reject(new Error(`WS connect failed: ${e.message}`));
    setTimeout(() => reject(new Error("WS connect timeout")), 3000);
  });

  try {
    await fn(port, ws);
  } finally {
    ws.close();
    stop();
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function expectError(result: any, contains: string) {
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain(contains);
}

function expectSuccess(result: any) {
  expect(result.isError).toBeFalsy();
}

// ═══════════════════════════════════════════════════════════════════════════
// browser_navigate
// ═══════════════════════════════════════════════════════════════════════════

describe("browser_navigate", () => {
  // ── Schema ────────────────────────────────────────────────────────────

  describe("schema", () => {
    test("has type object", () => {
      expect(BROWSER_NAVIGATE_SCHEMA.type).toBe("object");
    });

    test("url is required", () => {
      expect(BROWSER_NAVIGATE_SCHEMA.required).toContain("url");
    });

    test("waitUntil enum has valid values", () => {
      expect(BROWSER_NAVIGATE_SCHEMA.properties.waitUntil.enum).toEqual([
        "load",
        "domcontentloaded",
        "networkidle",
      ]);
    });
  });

  // ── Validation (no server needed — validation rejects before send()) ──

  describe("validation", () => {
    test("rejects empty params", async () => {
      const result = await browserNavigate({} as any);
      expectError(result, "Invalid navigate parameters");
    });

    test("rejects null params", async () => {
      const result = await browserNavigate(null as any);
      expectError(result, "Invalid navigate parameters");
    });

    test("rejects non-object params", async () => {
      const result = await browserNavigate("not-an-object" as any);
      expectError(result, "Invalid navigate parameters");
    });

    test("rejects empty url string", async () => {
      const result = await browserNavigate({ url: "" });
      expectError(result, "Invalid navigate parameters");
    });

    test("rejects missing url", async () => {
      const result = await browserNavigate({ waitUntil: "load" } as any);
      expectError(result, "Invalid navigate parameters");
    });

    test("rejects invalid waitUntil value", async () => {
      const result = await browserNavigate({
        url: "https://example.com",
        waitUntil: "never",
      } as any);
      expectError(result, "Invalid navigate parameters");
    });

    test("rejects non-integer timeout", async () => {
      const result = await browserNavigate({
        url: "https://example.com",
        timeout: 3.14,
      });
      expectError(result, "Invalid navigate parameters");
    });

    test("rejects non-positive timeout", async () => {
      const result = await browserNavigate({
        url: "https://example.com",
        timeout: 0,
      });
      expectError(result, "Invalid navigate parameters");
    });

    test("rejects negative timeout", async () => {
      const result = await browserNavigate({
        url: "https://example.com",
        timeout: -100,
      });
      expectError(result, "Invalid navigate parameters");
    });
  });

  // ── URL validation (no server needed — rejects before send()) ─────────

  describe("URL validation", () => {
    test("rejects malformed URL", async () => {
      const result = await browserNavigate({ url: "not a url" });
      expectError(result, "Invalid URL format");
    });

    test("rejects chrome:// URLs", async () => {
      const result = await browserNavigate({ url: "chrome://settings" });
      expectError(result, "blocked for security reasons");
    });

    test("rejects edge:// URLs", async () => {
      const result = await browserNavigate({ url: "edge://settings" });
      expectError(result, "blocked for security reasons");
    });

    test("rejects brave:// URLs", async () => {
      const result = await browserNavigate({ url: "brave://settings" });
      expectError(result, "blocked for security reasons");
    });
  });

  // ── Integration: error mapping & success ──────────────────────────────

  describe("integration", () => {
    test("returns URL and title on success", async () => {
      await withServer(async (_port, ws) => {
        ws.onmessage = (event) => {
          const req = JSON.parse(event.data as string);
          ws.send(
            JSON.stringify({
              id: req.id,
              result: { url: "https://example.com", title: "Example Domain" },
            }),
          );
        };

        const result = await browserNavigate({
          url: "https://example.com",
        });
        expectSuccess(result);
        expect(result.content[0].text).toContain(
          "Navigated to: https://example.com",
        );
        expect(result.content[0].text).toContain("Example Domain");
      });
    });

    test("maps server-side RESTRICTED_URL error", async () => {
      await withServer(async (_port, ws) => {
        ws.onmessage = (event) => {
          const req = JSON.parse(event.data as string);
          ws.send(
            JSON.stringify({
              id: req.id,
              error: {
                code: "RESTRICTED_URL",
                message: "URL is restricted",
              },
            }),
          );
        };

        const result = await browserNavigate({
          url: "https://example.com",
        });
        expectError(result, "Navigate failed");
        expect(result.content[0].text).toContain("restricted");
      });
    });

    test("maps server-side TIMEOUT error", async () => {
      await withServer(async (_port, ws) => {
        ws.onmessage = (event) => {
          const req = JSON.parse(event.data as string);
          ws.send(
            JSON.stringify({
              id: req.id,
              error: {
                code: "TIMEOUT",
                message: "Page load timeout",
              },
            }),
          );
        };

        const result = await browserNavigate({
          url: "https://slow.com",
          timeout: 5000,
        });
        expectError(result, "Navigate failed");
        expect(result.content[0].text).toContain("5000ms");
      });
    });

    test("maps BROWSER_NOT_CONNECTED on disconnect", async () => {
      await withServer(async (_port, ws) => {
        // Don't respond — just close
        ws.onmessage = () => {};

        const promise = browserNavigate({ url: "https://example.com" });

        // Small delay so request is registered
        await new Promise((r) => setTimeout(r, 50));

        // Close connection — triggers rejectAllPending
        ws.close();

        const result = await promise;
        expectError(result, "Navigate request failed");
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// browser_click
// ═══════════════════════════════════════════════════════════════════════════

describe("browser_click", () => {
  // ── Schema ────────────────────────────────────────────────────────────

  describe("schema", () => {
    test("selector is required", () => {
      expect(BROWSER_CLICK_SCHEMA.required).toContain("selector");
    });

    test("timeout has minimum 0", () => {
      expect(BROWSER_CLICK_SCHEMA.properties.timeout.minimum).toBe(0);
    });
  });

  // ── Validation ────────────────────────────────────────────────────────

  describe("validation", () => {
    test("rejects empty params", async () => {
      const result = await browserClick({} as any);
      expectError(result, "Invalid click parameters");
    });

    test("rejects missing selector", async () => {
      const result = await browserClick({ text: "Submit" } as any);
      expectError(result, "Invalid click parameters");
    });

    test("rejects empty selector", async () => {
      const result = await browserClick({ selector: "" });
      expectError(result, "Invalid click parameters");
    });

    test("rejects non-string text", async () => {
      const result = await browserClick({
        selector: ".btn",
        text: 123,
      } as any);
      expectError(result, "Invalid click parameters");
    });

    test("rejects non-integer timeout", async () => {
      const result = await browserClick({
        selector: ".btn",
        timeout: 3.14,
      });
      expectError(result, "Invalid click parameters");
    });

    test("rejects negative timeout", async () => {
      const result = await browserClick({
        selector: ".btn",
        timeout: -1,
      });
      expectError(result, "Invalid click parameters");
    });
  });

  // ── Integration ───────────────────────────────────────────────────────

  describe("integration", () => {
    test("accepts valid params with minimal click result", async () => {
      await withServer(async (_port, ws) => {
        ws.onmessage = (event) => {
          const req = JSON.parse(event.data as string);
          ws.send(
            JSON.stringify({
              id: req.id,
              result: {
                clicked: true,
                selector: ".btn",
                text: "Click me",
                navigated: false,
              },
            }),
          );
        };

        const result = await browserClick({ selector: ".btn" });
        expectSuccess(result);
        expect(result.content[0].text).toContain("Clicked element");
      });
    });

    test("maps ELEMENT_NOT_FOUND from server", async () => {
      await withServer(async (_port, ws) => {
        ws.onmessage = (event) => {
          const req = JSON.parse(event.data as string);
          ws.send(
            JSON.stringify({
              id: req.id,
              error: {
                code: "ELEMENT_NOT_FOUND",
                message: "Element not found",
                suggestion: "Try a different selector",
              },
            }),
          );
        };

        const result = await browserClick({ selector: ".missing" });
        expectError(result, "Click failed");
        expect(result.content[0].text).toContain("not found");
      });
    });

    test("maps ELEMENT_NOT_INTERACTABLE from server", async () => {
      await withServer(async (_port, ws) => {
        ws.onmessage = (event) => {
          const req = JSON.parse(event.data as string);
          ws.send(
            JSON.stringify({
              id: req.id,
              error: {
                code: "ELEMENT_NOT_INTERACTABLE",
                message: "Element hidden",
              },
            }),
          );
        };

        const result = await browserClick({ selector: ".hidden" });
        expectError(result, "Click failed");
      });
    });

    test("maps content-script ELEMENT_NOT_FOUND with suggestions", async () => {
      await withServer(async (_port, ws) => {
        ws.onmessage = (event) => {
          const req = JSON.parse(event.data as string);
          ws.send(
            JSON.stringify({
              id: req.id,
              result: {
                clicked: false,
                code: "ELEMENT_NOT_FOUND",
                message: "No matching element",
                suggestions: ["Button A", "Button B"],
              },
            }),
          );
        };

        const result = await browserClick({ selector: ".btn" });
        expectError(result, "Click failed");
        expect(result.content[0].text).toContain("Button A");
        expect(result.content[0].text).toContain("Button B");
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// browser_type
// ═══════════════════════════════════════════════════════════════════════════

describe("browser_type", () => {
  // ── Schema ────────────────────────────────────────────────────────────

  describe("schema", () => {
    test("selector and text are required", () => {
      expect(BROWSER_TYPE_SCHEMA.required).toContain("selector");
      expect(BROWSER_TYPE_SCHEMA.required).toContain("text");
    });

    test("clear defaults to true", () => {
      expect(BROWSER_TYPE_SCHEMA.properties.clear.default).toBe(true);
    });

    test("submit defaults to false", () => {
      expect(BROWSER_TYPE_SCHEMA.properties.submit.default).toBe(false);
    });
  });

  // ── Validation ────────────────────────────────────────────────────────

  describe("validation", () => {
    test("rejects empty params", async () => {
      const result = await browserType({} as any);
      expectError(result, "Invalid type parameters");
    });

    test("rejects missing text", async () => {
      const result = await browserType({ selector: "input" } as any);
      expectError(result, "Invalid type parameters");
    });

    test("rejects missing selector", async () => {
      const result = await browserType({ text: "hello" } as any);
      expectError(result, "Invalid type parameters");
    });

    test("rejects non-boolean clear", async () => {
      const result = await browserType({
        selector: "input",
        text: "hello",
        clear: "yes",
      } as any);
      expectError(result, "Invalid type parameters");
    });

    test("rejects non-boolean submit", async () => {
      const result = await browserType({
        selector: "input",
        text: "hello",
        submit: "yes",
      } as any);
      expectError(result, "Invalid type parameters");
    });

    test("rejects non-finite timeout", async () => {
      const result = await browserType({
        selector: "input",
        text: "hello",
        timeout: Infinity,
      });
      expectError(result, "Invalid type parameters");
    });

    test("rejects negative timeout", async () => {
      const result = await browserType({
        selector: "input",
        text: "hello",
        timeout: -1,
      });
      expectError(result, "Invalid type parameters");
    });
  });

  // ── Integration ───────────────────────────────────────────────────────

  describe("integration", () => {
    test("reports typed value on success", async () => {
      await withServer(async (_port, ws) => {
        ws.onmessage = (event) => {
          const req = JSON.parse(event.data as string);
          ws.send(
            JSON.stringify({
              id: req.id,
              result: {
                typed: true,
                selector: "#email",
                value: "user@example.com",
              },
            }),
          );
        };

        const result = await browserType({
          selector: "#email",
          text: "user@example.com",
        });
        expectSuccess(result);
        expect(result.content[0].text).toContain('Typed into "#email"');
        expect(result.content[0].text).toContain("user@example.com");
      });
    });

    test("maps ELEMENT_NOT_FOUND", async () => {
      await withServer(async (_port, ws) => {
        ws.onmessage = (event) => {
          const req = JSON.parse(event.data as string);
          ws.send(
            JSON.stringify({
              id: req.id,
              error: {
                code: "ELEMENT_NOT_FOUND",
                message: "#missing not found",
              },
            }),
          );
        };

        const result = await browserType({
          selector: "#missing",
          text: "hello",
        });
        expectError(result, "Type failed");
        expect(result.content[0].text).toContain("#missing");
      });
    });

    test("maps ELEMENT_NOT_TYPABLE", async () => {
      await withServer(async (_port, ws) => {
        ws.onmessage = (event) => {
          const req = JSON.parse(event.data as string);
          ws.send(
            JSON.stringify({
              id: req.id,
              error: {
                code: "ELEMENT_NOT_TYPABLE",
                message: "Not a typable element",
              },
            }),
          );
        };

        const result = await browserType({
          selector: "div",
          text: "hello",
        });
        expectError(result, "Type failed");
        expect(result.content[0].text).toContain("typable");
      });
    });

    test("maps ELEMENT_NOT_INTERACTABLE", async () => {
      await withServer(async (_port, ws) => {
        ws.onmessage = (event) => {
          const req = JSON.parse(event.data as string);
          ws.send(
            JSON.stringify({
              id: req.id,
              error: {
                code: "ELEMENT_NOT_INTERACTABLE",
                message: "Element disabled",
              },
            }),
          );
        };

        const result = await browserType({
          selector: "input[disabled]",
          text: "hello",
        });
        expectError(result, "Type failed");
        expect(result.content[0].text).toContain("interactable");
      });
    });

    test("handles false typed result", async () => {
      await withServer(async (_port, ws) => {
        ws.onmessage = (event) => {
          const req = JSON.parse(event.data as string);
          ws.send(
            JSON.stringify({
              id: req.id,
              result: { typed: false, selector: "input" },
            }),
          );
        };

        const result = await browserType({
          selector: "input",
          text: "hello",
        });
        expectError(result, "Type failed");
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// browser_read
// ═══════════════════════════════════════════════════════════════════════════

describe("browser_read", () => {
  // ── Schema ────────────────────────────────────────────────────────────

  describe("schema", () => {
    test("has no required fields", () => {
      expect(BROWSER_READ_SCHEMA.required).toEqual([]);
    });

    test("maxLength has minimum 1", () => {
      expect(BROWSER_READ_SCHEMA.properties.maxLength.minimum).toBe(1);
    });
  });

  // ── Validation ────────────────────────────────────────────────────────

  describe("validation", () => {
    test("rejects non-string selector", async () => {
      const result = await browserRead({ selector: 123 } as any);
      expectError(result, "Invalid read parameters");
    });

    test("rejects non-integer maxLength", async () => {
      const result = await browserRead({ maxLength: 1.5 } as any);
      expectError(result, "Invalid read parameters");
    });

    test("rejects maxLength zero", async () => {
      const result = await browserRead({ maxLength: 0 });
      expectError(result, "Invalid read parameters");
    });
  });

  // ── Integration ───────────────────────────────────────────────────────

  describe("integration", () => {
    test("returns text content", async () => {
      await withServer(async (_port, ws) => {
        ws.onmessage = (event) => {
          const req = JSON.parse(event.data as string);
          ws.send(
            JSON.stringify({
              id: req.id,
              result: {
                text: "<h1>Hello World</h1><p>Some paragraph</p>",
                length: 38,
              },
            }),
          );
        };

        const result = await browserRead({});
        expectSuccess(result);
        expect(result.content[0].text).toContain("Hello World");
      });
    });

    test("includes truncation note when truncated", async () => {
      await withServer(async (_port, ws) => {
        ws.onmessage = (event) => {
          const req = JSON.parse(event.data as string);
          ws.send(
            JSON.stringify({
              id: req.id,
              result: {
                text: "beginning of text...",
                length: 10000,
                truncated: true,
              },
            }),
          );
        };

        const result = await browserRead({ maxLength: 100 });
        expectSuccess(result);
        expect(result.content[0].text).toContain("truncated");
        expect(result.content[0].text).toContain("100");
      });
    });

    test("maps server-side error with suggestion", async () => {
      await withServer(async (_port, ws) => {
        ws.onmessage = (event) => {
          const req = JSON.parse(event.data as string);
          ws.send(
            JSON.stringify({
              id: req.id,
              error: {
                code: "ELEMENT_NOT_FOUND",
                message: "Selector not found",
                suggestion: "Try body instead",
              },
            }),
          );
        };

        const result = await browserRead({ selector: ".nonexistent" });
        expectError(result, "Read failed");
        expect(result.content[0].text).toContain("Try body instead");
      });
    });

    test("handles missing text in result", async () => {
      await withServer(async (_port, ws) => {
        ws.onmessage = (event) => {
          const req = JSON.parse(event.data as string);
          ws.send(
            JSON.stringify({
              id: req.id,
              result: {},
            }),
          );
        };

        const result = await browserRead({});
        expectError(result, "no text content");
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// browser_screenshot
// ═══════════════════════════════════════════════════════════════════════════

describe("browser_screenshot", () => {
  // ── Schema ────────────────────────────────────────────────────────────

  describe("schema", () => {
    test("has no required fields", () => {
      expect(BROWSER_SCREENSHOT_SCHEMA.required).toEqual([]);
    });

    test("format enum is png | jpeg", () => {
      expect(BROWSER_SCREENSHOT_SCHEMA.properties.format.enum).toEqual([
        "png",
        "jpeg",
      ]);
    });

    test("quality range is 0-100", () => {
      expect(BROWSER_SCREENSHOT_SCHEMA.properties.quality.minimum).toBe(0);
      expect(BROWSER_SCREENSHOT_SCHEMA.properties.quality.maximum).toBe(100);
    });
  });

  // ── Validation ────────────────────────────────────────────────────────

  describe("validation", () => {
    test("rejects invalid format", async () => {
      const result = await browserScreenshot({ format: "gif" } as any);
      expectError(result, "Invalid screenshot parameters");
    });

    test("rejects quality below 0", async () => {
      const result = await browserScreenshot({ quality: -1 });
      expectError(result, "Invalid screenshot parameters");
    });

    test("rejects quality above 100", async () => {
      const result = await browserScreenshot({ quality: 101 });
      expectError(result, "Invalid screenshot parameters");
    });

    test("rejects non-integer quality", async () => {
      const result = await browserScreenshot({ quality: 80.5 });
      expectError(result, "Invalid screenshot parameters");
    });

    test("rejects non-boolean fullPage", async () => {
      const result = await browserScreenshot({ fullPage: "yes" } as any);
      expectError(result, "Invalid screenshot parameters");
    });
  });

  // ── Integration ───────────────────────────────────────────────────────

  describe("integration", () => {
    test("returns image content block with base64 data", async () => {
      await withServer(async (_port, ws) => {
        ws.onmessage = (event) => {
          const req = JSON.parse(event.data as string);
          ws.send(
            JSON.stringify({
              id: req.id,
              result: {
                data: "iVBORw0KGgo=",
                format: "png",
              },
            }),
          );
        };

        const result = await browserScreenshot({ format: "png" });
        expectSuccess(result);

        const block = result.content[0];
        expect(block.type).toBe("image");
        expect(block.source.type).toBe("base64");
        expect(block.source.mediaType).toBe("image/png");
        expect(block.source.data).toBe("iVBORw0KGgo=");
      });
    });

    test("accepts valid jpeg format", async () => {
      await withServer(async (_port, ws) => {
        ws.onmessage = (event) => {
          const req = JSON.parse(event.data as string);
          ws.send(
            JSON.stringify({
              id: req.id,
              result: { data: "abc=", format: "jpeg" },
            }),
          );
        };

        const result = await browserScreenshot({
          format: "jpeg",
          quality: 90,
        });
        expectSuccess(result);
        expect(result.content[0].source.mediaType).toBe("image/jpeg");
      });
    });

    test("attaches warning as text block", async () => {
      await withServer(async (_port, ws) => {
        ws.onmessage = (event) => {
          const req = JSON.parse(event.data as string);
          ws.send(
            JSON.stringify({
              id: req.id,
              result: {
                data: "abc=",
                format: "png",
                warning: "fullPage is viewport-only in v1",
              },
            }),
          );
        };

        const result = await browserScreenshot({ fullPage: true });
        expectSuccess(result);
        expect(result.content).toHaveLength(2);
        expect(result.content[1].type).toBe("text");
        expect(result.content[1].text).toContain("v1");
      });
    });

    test("maps RESTRICTED_URL error", async () => {
      await withServer(async (_port, ws) => {
        ws.onmessage = (event) => {
          const req = JSON.parse(event.data as string);
          ws.send(
            JSON.stringify({
              id: req.id,
              error: {
                code: "RESTRICTED_URL",
                message: "Cannot screenshot restricted page",
              },
            }),
          );
        };

        const result = await browserScreenshot({});
        expectError(result, "Screenshot failed");
        expect(result.content[0].text).toContain("restricted");
      });
    });

    test("handles missing image data", async () => {
      await withServer(async (_port, ws) => {
        ws.onmessage = (event) => {
          const req = JSON.parse(event.data as string);
          ws.send(
            JSON.stringify({
              id: req.id,
              result: {},
            }),
          );
        };

        const result = await browserScreenshot({});
        expectError(result, "no image data");
      });
    });
  });
});
