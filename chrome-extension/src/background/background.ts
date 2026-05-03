/**
 * Chrome extension service worker entry point.
 *
 * Thin orchestration layer — delegates all logic to the infrastructure
 * and application layers. This file only imports, wires, and starts.
 *
 * @module background
 */

import { createLogger } from "@pi-browser-bridge/logger";
import { init } from "../infrastructure/index.js";

const logger = createLogger("chrome-ext");

// ── Initialize ─────────────────────────────────────────────────────────

// Module-scope references populated by init().
// Avoids top-level await (MV3 service worker + crxjs/vite limitation).
export let connect: () => void;
export let getActiveTabId: () => Promise<number | null>;
export let loadPort: () => Promise<number>;
export let savePort: (port: number) => Promise<void>;

init(logger).then((api) => {
  connect = api.connect;
  getActiveTabId = api.getActiveTabId;
  loadPort = api.loadPort;
  savePort = api.savePort;
  connect();
});
