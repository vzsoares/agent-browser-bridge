/**
 * Typed mock for chrome.tabs.* APIs.
 *
 * Simulates tab query, message sending, and screenshot capture.
 * Uses an in-memory tab store for query results.
 *
 * @module mock-chrome-tabs
 */

import { vi } from "vitest";

// ── Types ─────────────────────────────────────────────────────────────

export interface MockTab {
  id?: number;
  index?: number;
  windowId?: number;
  url?: string;
  title?: string;
  active?: boolean;
  pinned?: boolean;
  status?: "loading" | "complete";
}

// ── State ─────────────────────────────────────────────────────────────

let mockTabs: MockTab[] = [];
let nextTabId = 1;

// ── Mock ──────────────────────────────────────────────────────────────

/**
 * Mock implementation of chrome.tabs API.
 *
 * Usage:
 * ```ts
 * import { chromeTabsMock } from "./mocks/chrome-tabs.js";
 *
 * // Populate tabs
 * chromeTabsMock.setTabs([
 *   { id: 1, url: "https://example.com", active: true },
 * ]);
 *
 * // Query tabs
 * const tabs = await chrome.tabs.query({ active: true });
 * expect(tabs).toHaveLength(1);
 * ```
 */
export const chromeTabsMock = {
  // ── Tab management ────────────────────────────────────────────────

  /** Set the list of mock tabs (replaces current state). */
  setTabs(tabs: MockTab[]): void {
    mockTabs = tabs.map((t) => ({
      id: t.id ?? nextTabId++,
      index: t.index ?? 0,
      windowId: t.windowId ?? 1,
      ...t,
    }));
  },

  /** Add a tab to the mock store. */
  addTab(tab: MockTab): MockTab {
    const full = {
      id: tab.id ?? nextTabId++,
      index: tab.index ?? mockTabs.length,
      windowId: tab.windowId ?? 1,
      ...tab,
    };
    mockTabs.push(full);
    return full;
  },

  /** Get all mock tabs (read-only copy). */
  getTabs(): readonly MockTab[] {
    return [...mockTabs];
  },

  /** Reset tab state. */
  reset(): void {
    mockTabs = [];
    nextTabId = 1;
  },

  // ── API methods ───────────────────────────────────────────────────

  query: vi.fn(
    (
      queryInfo: chrome.tabs.QueryInfo,
    ): Promise<chrome.tabs.Tab[]> => {
      let results = [...mockTabs];

      if (queryInfo.active !== undefined) {
        results = results.filter((t) => t.active === queryInfo.active);
      }
      if (queryInfo.url !== undefined) {
        const pattern = queryInfo.url;
        if (typeof pattern === "string") {
          results = results.filter((t) => t.url?.includes(pattern));
        } else if (Array.isArray(pattern)) {
          results = results.filter((t) =>
            pattern.some((p) => t.url?.includes(p)),
          );
        }
      }
      if (queryInfo.status !== undefined) {
        results = results.filter((t) => t.status === queryInfo.status);
      }

      return Promise.resolve(
        results.map((t) => ({
          id: t.id!,
          index: t.index ?? 0,
          windowId: t.windowId ?? 1,
          url: t.url,
          title: t.title,
          active: t.active ?? false,
          pinned: t.pinned ?? false,
          status: t.status,
        })) as chrome.tabs.Tab[],
      );
    },
  ),

  sendMessage: vi.fn(
    (
      _tabId: number,
      _message: unknown,
    ): Promise<unknown> => {
      // Default: resolve with empty response
      return Promise.resolve({});
    },
  ),

  captureVisibleTab: vi.fn(
    (
      _windowId?: number,
      _options?: { format?: "jpeg" | "png"; quality?: number },
    ): Promise<string> => {
      // Return a minimal valid data URL (1x1 transparent PNG)
      return Promise.resolve(
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
      );
    },
  ),
};

/**
 * Install the mock on globalThis.chrome.tabs.
 * Call in beforeAll to make chrome.tabs available to tested code.
 */
export function installChromeTabsMock(): void {
  // Assign mock to globalThis.chrome.tabs for Node test environments.
  const g = globalThis as Record<string, unknown>;
  g.chrome = g.chrome ?? {};
  (g.chrome as Record<string, unknown>).tabs = chromeTabsMock;
}
