/**
 * Typed mock for chrome.storage.* APIs.
 *
 * Simulates chrome.storage.local.get/set with an in-memory store.
 *
 * @module mock-chrome-storage
 */

import { vi } from "vitest";

// ── State ─────────────────────────────────────────────────────────────

let storage: Record<string, unknown> = {};

// ── Mock ──────────────────────────────────────────────────────────────

/**
 * Mock implementation of chrome.storage.local API.
 *
 * Usage:
 * ```ts
 * import { chromeStorageMock } from "./mocks/chrome-storage.js";
 *
 * // Pre-populate storage
 * chromeStorageMock.setStore({ myKey: "myValue" });
 *
 * // Code under test calls chrome.storage.local.get(...)
 * const result = await chrome.storage.local.get("myKey");
 * expect(result.myKey).toBe("myValue");
 * ```
 */
export const chromeStorageMock = {
  // ── Store manipulation ────────────────────────────────────────────

  /** Replace the entire in-memory store. */
  setStore(data: Record<string, unknown>): void {
    storage = { ...data };
  },

  /** Get a copy of the current store. */
  getStore(): Readonly<Record<string, unknown>> {
    return { ...storage };
  },

  /** Reset the store to empty. */
  reset(): void {
    storage = {};
  },

  // ── API methods ───────────────────────────────────────────────────

  get: vi.fn(
    (
      keys?: string | string[] | Record<string, unknown> | null,
    ): Promise<Record<string, unknown>> => {
      if (keys === null || keys === undefined) {
        // Return entire store
        return Promise.resolve({ ...storage });
      }

      if (typeof keys === "string") {
        return Promise.resolve({
          [keys]: storage[keys],
        });
      }

      if (Array.isArray(keys)) {
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          result[key] = storage[key];
        }
        return Promise.resolve(result);
      }

      // keys is an object with default values
      const result = { ...storage };
      for (const key of Object.keys(keys)) {
        if (result[key] === undefined) {
          result[key] = keys[key];
        }
      }
      return Promise.resolve(result);
    },
  ),

  set: vi.fn(
    (items: Record<string, unknown>): Promise<void> => {
      Object.assign(storage, items);
      return Promise.resolve();
    },
  ),
};

/**
 * Install the mock on globalThis.chrome.storage.local.
 * Call in beforeAll to make chrome.storage.local available to tested code.
 */
export function installChromeStorageMock(): void {
  // Assign mock to globalThis.chrome.storage.local for Node test environments.
  const g = globalThis as Record<string, unknown>;
  g.chrome = g.chrome ?? {};
  (g.chrome as Record<string, unknown>).storage = { local: chromeStorageMock };
}
