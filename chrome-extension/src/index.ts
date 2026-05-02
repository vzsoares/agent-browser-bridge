// @pi-browser-bridge/chrome-extension — Chrome extension
// Service worker, content script, popup UI.
//
// The Vite build uses manifest.json paths directly, so this file is a
// barrel re-export for consumers who import the package from source.
export { connect, getActiveTabId, loadPort, savePort } from "./background/background.js";
