/**
 * @pi-browser-bridge/chrome-extension — package barrel export.
 *
 * Re-exports public symbols for consumers who import the package
 * from source (e.g. tests, Node.js tools).
 */

export {
  connect,
  getActiveTabId,
  loadPort,
  savePort,
} from "./background/background.js";
