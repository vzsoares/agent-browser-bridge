/**
 * Typed mock for chrome.runtime.onMessage API.
 *
 * Simulates message listeners and cross-context message dispatch.
 *
 * @module mock-chrome-runtime
 */

import { vi } from "vitest";

// ── Types ─────────────────────────────────────────────────────────────

type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined | void;

// ── State ─────────────────────────────────────────────────────────────

let listeners: MessageListener[] = [];

// ── Mock ──────────────────────────────────────────────────────────────

/**
 * Mock implementation of chrome.runtime.onMessage.
 *
 * Usage:
 * ```ts
 * import { chromeRuntimeMock } from "./mocks/chrome-runtime.js";
 *
 * // Code under test registers a listener
 * chrome.runtime.onMessage.addListener(myHandler);
 *
 * // Simulate an incoming message from the server
 * chromeRuntimeMock.simulateMessage(
 *   { action: "navigate", id: "1", params: { url: "https://example.com" } },
 * );
 * ```
 */
export const chromeRuntimeMock = {
  // ── Listener management ───────────────────────────────────────────

  addListener: vi.fn((listener: MessageListener) => {
    listeners.push(listener);
  }),

  removeListener: vi.fn((listener: MessageListener) => {
    listeners = listeners.filter((l) => l !== listener);
  }),

  hasListeners: vi.fn(() => listeners.length > 0),

  hasListener: vi.fn((listener: MessageListener) => {
    return listeners.includes(listener);
  }),

  // ── Message simulation ────────────────────────────────────────────

  /**
   * Simulate a message arriving from a content script or background.
   * Calls all registered listeners with the given message.
   *
   * @returns Array of sendResponse callbacks (if listener returned true).
   */
  simulateMessage(
    message: unknown,
    sender: Partial<chrome.runtime.MessageSender> = {},
  ): Array<(response?: unknown) => void> | null {
    const sendResponseCallbacks: Array<(response?: unknown) => void> = [];
    const fullSender: chrome.runtime.MessageSender = {
      id: sender.id ?? "mock-extension-id",
      url: sender.url,
      origin: sender.origin,
      tab: sender.tab,
      tlsChannelId: sender.tlsChannelId,
      frameId: sender.frameId,
      documentId: sender.documentId,
      documentLifecycle: sender.documentLifecycle,
    };

    for (const listener of listeners) {
      let asyncResponse = false;
      const sendResponse = (response?: unknown) => {
        sendResponseCallbacks.push(() => response);
      };
      const result = listener(message, fullSender, sendResponse);
      if (result === true) {
        asyncResponse = true;
      }
    }

    return sendResponseCallbacks.length > 0 ? sendResponseCallbacks : null;
  },

  /** Reset all listeners and state. */
  reset(): void {
    listeners = [];
  },

  /** Get current listener count. */
  getListenerCount(): number {
    return listeners.length;
  },
};

/**
 * Install the mock on globalThis.chrome.runtime.onMessage.
 * Call in beforeAll to make chrome.runtime.onMessage available to tested code.
 */
export function installChromeRuntimeMock(): void {
  // Assign mock to globalThis.chrome.runtime.onMessage for Node test environments.
  const g = globalThis as Record<string, unknown>;
  g.chrome = g.chrome ?? {};
  (g.chrome as Record<string, unknown>).runtime = { onMessage: chromeRuntimeMock };
}
