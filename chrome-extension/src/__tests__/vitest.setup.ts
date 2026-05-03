/**
 * Vitest setup for chrome-extension tests.
 *
 * Configures happy-dom as the DOM environment and provides
 * global mocks for Chrome extension APIs that are unavailable
 * in a Node.js/Vitest runtime.
 *
 * @module vitest-setup
 */

import { beforeAll, vi } from "vitest";

// ── DOM globals (happy-dom) ──────────────────────────────────────────

// happy-dom provides: document, window, Node, Element, HTMLElement,
// MouseEvent, KeyboardEvent, etc. — no additional setup needed.

// ── Chrome API stubs ─────────────────────────────────────────────────

// Chrome extension types are available from @types/chrome.
// Tests should use the mock utilities in ./mocks/ for full control.
// These stubs prevent ReferenceErrors when chrome.* is accessed
// outside of mock setup.

beforeAll(() => {
  // Global chrome namespace stub — individual tests override via mocks
  if (typeof (globalThis as Record<string, unknown>).chrome === "undefined") {
    (globalThis as Record<string, unknown>).chrome = {};
  }
});

// ── WebSocket stub ────────────────────────────────────────────────────

// The native WebSocket is not available in happy-dom (Node runtime).
// Tests using WebSocket must import the mock from ./mocks/websocket.ts.

// ── Cleanup ───────────────────────────────────────────────────────────

// happy-dom resets the DOM between tests automatically via vitest's
// default isolation (each test file gets a fresh environment).
