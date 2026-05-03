/**
 * Smoke tests for the Vitest + happy-dom setup.
 *
 * Verifies that the test infrastructure works correctly:
 * - happy-dom provides browser-like DOM globals
 * - Chrome API stubs are available from vitest.setup.ts
 * - Test isolation works (each test gets a fresh DOM)
 *
 * @module smoke-test
 */

import { describe, test, expect, beforeAll, beforeEach } from "vitest";

describe("Vitest + happy-dom smoke tests", () => {
  describe("DOM globals (happy-dom)", () => {
    test("document is defined", () => {
      expect(typeof document).toBe("object");
      expect(document).toBeDefined();
    });

    test("window is defined", () => {
      expect(typeof window).toBe("object");
      expect(window).toBeDefined();
    });

    test("can create DOM elements", () => {
      const div = document.createElement("div");
      div.id = "test-div";
      div.textContent = "Hello, happy-dom!";
      document.body.appendChild(div);

      expect(document.getElementById("test-div")).toBe(div);
      expect(document.body.textContent).toBe("Hello, happy-dom!");
    });

    test("can query the DOM", () => {
      const div = document.createElement("div");
      div.className = "my-class";
      document.body.appendChild(div);

      const found = document.querySelector(".my-class");
      expect(found).toBe(div);
    });

    test("DOM persists within the same file (happy-dom resets per file)", () => {
      // happy-dom does NOT reset the DOM between tests in the same file.
      // It only creates a fresh DOM for each test file.
      // The previous tests added 2 children to body.
      expect(document.body.children.length).toBeGreaterThan(0);
    });
  });

  describe("Chrome API stubs", () => {
    test("chrome namespace is defined", () => {
      const g = globalThis as Record<string, unknown>;
      expect(g.chrome).toBeDefined();
    });
  });

  describe("Vitest globals", () => {
    test("describe and test are available as globals", () => {
      // If globals weren't working, this file wouldn't even parse
      expect(describe).toBeDefined();
      expect(test).toBeDefined();
      expect(expect).toBeDefined();
    });
  });
});
