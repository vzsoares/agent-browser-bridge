# PRD: Pi Browser Extension

**Status:** Draft
**Created:** 2026-05-02
**Author:** AI Agent (from discussion with Marco)
**Version:** 1.0

---

## Executive Summary

A Chrome extension + pi coding agent extension pair that lets pi control a web browser
on the user's behalf. The pi extension registers LLM-callable tools (`browser_navigate`,
`browser_click`, `browser_type`, `browser_screenshot`, `browser_read`) that proxy
commands to the Chrome extension over a local WebSocket. The Chrome extension executes
them inside the browser and returns results. Think "Antigravity Browser Extension, but
purpose-built for pi."

---

## Problem Statement

Pi is a terminal-based coding agent. It can read files, run bash commands, and edit
code — but it can't see or interact with a web browser. When a user asks pi to "fill
out this form," "check if the deployment looks right," or "scrape the docs for this
API," pi is blind. The user has to manually copy-paste browser content into pi, or
switch to a different tool entirely.

**Current alternatives:**
- Copy-pasting HTML/text into pi (slow, error-prone)
- Using Playwright/Puppeteer via bash (heavy, fragile, requires Node setup)
- Switching to Cursor or Claude Code with their built-in browser extensions (leaves pi)

**Pain point:** Pi users who do web work (frontend dev, QA, scraping, form automation)
have no first-class browser control.

---

## Goals

- **G1:** Let pi navigate to URLs, click elements, type text, capture screenshots, and
  read visible page text — all through tools the LLM naturally calls.
- **G2:** Communication between pi and the browser must be local, fast, and require
  zero cloud services.
- **G3:** The setup experience must be minimal: install the pi extension, install the
  Chrome extension, they auto-connect via `ws://localhost`.
- **G4:** The Chrome extension must be a standard MV3 extension, publishable to the
  Chrome Web Store.
- **G5:** The pi extension must be installable as a pi package (`pi install
  npm:pi-browser-extension` or via `git:`).

---

## Non-Goals

- **NG1:** No Firefox/Safari/Edge support in v1 (Chrome only; architecture permits others later).
- **NG2:** No Playwright-level fidelity (no `page.evaluate()`, no network interception,
  no iframe handling, no drag-and-drop).
- **NG3:** No remote browser control (localhost only). No tunneling, no cloud relays.
- **NG4:** No multi-tab orchestration beyond the active tab.
- **NG5:** No authentication — assumes trust at the OS user boundary.
- **NG6:** No cookie/session persistence management.
- **NG7:** No visual element picker UI in the extension popup (v1 is headless/agent-driven only).

---

## User Stories

### Must Have (P0)

- As a pi user, I want to tell pi "go to localhost:4321 and take a screenshot" and
  get back an image I can inspect, so that I can visually verify my frontend work
  without leaving the terminal.
- As a pi user, I want pi to navigate to a documentation page and extract the visible
  text content, so that the LLM can read API docs, release notes, or error pages
  without me copy-pasting.
- As a pi user, I want pi to click a button or link on a page, so that it can
  interact with SPAs, run through multi-step flows, or fill out forms.
- As a pi user, I want pi to type text into input fields, so that it can fill forms,
  search, or log into apps (when I provide credentials).

### Should Have (P1)

- As a pi user, I want pi to wait for specific text or an element to appear after
  a navigation before proceeding, so that it doesn't act on stale DOM.
- As a pi user, I want the Chrome extension to show connection status (connected /
  disconnected / error) in its toolbar icon, so that I know if pi can reach the
  browser.
- As a pi user, I want to see errors when a selector isn't found or a page fails
  to load, with actionable messages, so that the LLM can self-correct.

### Nice to Have (P2)

- As a pi user, I want to limit which domains the browser extension can access
  (configurable allowlist), so that I have a security boundary.
- As a pi user, I want pi to be able to execute arbitrary JavaScript in the page
  context and get the return value, so that advanced scraping/interaction is possible.
- As a pi user, I want the extension to support multiple concurrent pi sessions
  (or at least handle reconnection gracefully).

---

## Functional Requirements

### FR-1: WebSocket Communication Protocol

- The pi extension must start a WebSocket server on `ws://localhost:9242` (configurable).
- The Chrome extension must connect to that server and maintain the connection.
- Messages must use a JSON request/response protocol:
  ```json
  // Request (pi → browser)
  { "id": "req-1", "action": "navigate", "params": { "url": "https://example.com" } }

  // Success response (browser → pi)
  { "id": "req-1", "result": { "url": "https://example.com", "title": "Example Domain" } }

  // Error response (browser → pi)
  { "id": "req-1", "error": { "code": "TIMEOUT", "message": "Page load timed out after 30s" } }
  ```
- The pi extension must timeout requests after 30 seconds (configurable).
- The Chrome extension must handle disconnection gracefully and auto-reconnect with
  exponential backoff (1s, 2s, 4s, max 30s).
- Edge case: If the pi WebSocket server is not running, the Chrome extension should
  show a "disconnected" badge and retry silently.
- Edge case: If the Chrome extension is not installed/connected, pi tools should
  return clear error messages ("Browser extension not connected. Is it installed?").

### FR-2: `browser_navigate` Tool

- Pi tool name: `browser_navigate`
- Parameters:
  - `url` (string, required) — The URL to navigate to. Must be a valid absolute URL.
  - `waitUntil` (enum, optional) — `"load"` (default, waits for window.load event),
    `"domcontentloaded"`, or `"networkidle"` (heuristic: no network activity for 500ms).
  - `timeout` (number, optional) — Max wait time in ms (default: 30000).
- Behavior: Tells the active tab to navigate to `url`. Waits for the page to reach
  the `waitUntil` state. Returns the final URL (in case of redirects) and the page
  title.
- Edge case: If the URL is invalid, return error with code `INVALID_URL`.
- Edge case: If navigation times out, return error with code `TIMEOUT` and partial
  info (last known URL, if any).
- Edge case: If the tab is on `chrome://` or `chrome-extension://` pages, block
  with error `RESTRICTED_URL`.

### FR-3: `browser_click` Tool

- Pi tool name: `browser_click`
- Parameters:
  - `selector` (string, required) — CSS selector of the element to click.
  - `text` (string, optional) — If provided, clicks the element matching the selector
    that contains this text content (fuzzy match). Useful for "click the button that
    says Submit."
  - `timeout` (number, optional) — Max wait time for element to appear (default: 10000).
- Behavior: Finds the element matching `selector` (+ optional `text` filter), scrolls
  it into view, and clicks it.
- Edge case: If no element matches, return error `ELEMENT_NOT_FOUND`.
- Edge case: If multiple elements match `selector` but none match `text`, return
  error `ELEMENT_NOT_FOUND` with a list of the text contents of the matched elements.
- Edge case: If the element is hidden/disabled, return error `ELEMENT_NOT_INTERACTABLE`.
- Edge case: After clicking, wait briefly (300ms) for any navigation or DOM changes
  to settle before returning. Return the new page title if navigation occurred.

### FR-4: `browser_type` Tool

- Pi tool name: `browser_type`
- Parameters:
  - `selector` (string, required) — CSS selector for the input/textarea element.
  - `text` (string, required) — Text to type.
  - `clear` (boolean, optional, default: `true`) — Whether to clear the field first.
  - `submit` (boolean, optional, default: `false`) — Whether to press Enter after typing.
  - `timeout` (number, optional) — Max wait time for element (default: 10000).
- Behavior: Focuses the element, optionally clears it, types the text character by
  character (or sets `value` directly + dispatches input events), optionally presses
  Enter.
- Edge case: If element is not a text input/textarea/contenteditable, return error
  `ELEMENT_NOT_TYPABLE`.
- Edge case: If `submit: true` and there's no form, still press Enter (it's what
  the user asked for).

### FR-5: `browser_screenshot` Tool

- Pi tool name: `browser_screenshot`
- Parameters:
  - `format` (enum, optional, default: `"png"`) — `"png"` or `"jpeg"`.
  - `quality` (number, optional, default: 80) — JPEG quality (0-100, only for jpeg).
  - `fullPage` (boolean, optional, default: `false`) — Capture the full scrollable
    page, not just the viewport.
- Behavior: Captures the active tab as an image. Returns a base64-encoded data URL
  (`data:image/png;base64,...`).
- Edge case: If `fullPage: true`, use Chrome's `captureVisibleTab` for the viewport
  and stitch via scroll offsets (or use Chrome DevTools Protocol if permission allows).
  If full-page capture fails, fall back to viewport and warn in result.
- Edge case: Screenshot of `chrome://` pages must be blocked.
- Behavioral note: The LLM can "see" the screenshot because pi's `read` tool supports
  images. The pi extension should return the screenshot as a content block compatible
  with pi's image format.

### FR-6: `browser_read` Tool

- Pi tool name: `browser_read`
- Parameters:
  - `selector` (string, optional) — CSS selector to scope reading. If omitted, reads
    the entire visible page body.
  - `maxLength` (number, optional, default: 50000) — Truncate text beyond this length.
- Behavior: Extracts visible text content from the page (or the selected element),
  preserving basic structure (headings, paragraphs, list items, links with hrefs,
  button labels, input placeholders/values).
- Returns: The extracted text as a plain string. Should be LLM-friendly (no HTML
  tags, just structured text with newlines).
- Edge case: If `selector` matches nothing, return error `ELEMENT_NOT_FOUND`.
- Edge case: If text exceeds `maxLength`, truncate and append `... [truncated, N chars total]`.
- Edge case: Hidden elements (`display: none`, `visibility: hidden`) must be excluded.
- Design decision: Exclude `<script>` and `<style>` contents. Include `alt` text for
  images. Include `aria-label` when it adds meaning.

### FR-7: Chrome Extension Background Service Worker

- Must be an MV3 Service Worker (not a persistent background page).
- Responsibilities: WebSocket client connection to pi, message routing, tab management,
  screenshot capture via `chrome.tabs.captureVisibleTab`.
- Content script injection: Must inject a content script into the active tab to
  perform DOM operations (click, type, read). Communication between SW and content
  script via `chrome.tabs.sendMessage`.
- The extension must request minimal permissions:
  - `activeTab` — for DOM access and screenshot
  - `scripting` — for content script injection
  - `storage` — for saving settings (port, allowlist)
  - Host permission: `<all_urls>` (scary, but required for navigate/read on any
    page; user must grant on install)
- The extension popup (if any) shows: connection status, connected pi session info,
  a toggle to enable/disable the bridge.
- Edge case: If the service worker is terminated by Chrome (idle timeout), the
  WebSocket connection drops. The extension must reconnect when the worker wakes.

### FR-8: Pi Extension Structure

- Lives as a pi package, consumed via `pi install` or manual file placement.
- Package name: `pi-browser-extension` (npm) or `marco-souza/pi-browser-extension`
  (git).
- Pi extension entry: `src/index.ts` (or `pi-extension/index.ts` in the monorepo).
- Dependencies: `ws` (WebSocket server for Node.js).
- The extension must be compatible with pi's extension system (exports a default
  function receiving `ExtensionAPI`).
- All six tools must be registered via `pi.registerTool()`.
- The WebSocket server must start on `session_start` and stop on `session_shutdown`.
- Each tool handler must: serialize the request → send via WebSocket → await response
  → deserialize → return in pi's tool result format.

### FR-9: Shared Types / Protocol

- Both sides must share the same protocol types (action names, request/response shapes,
  error codes).
- These types should be defined in a shared location that both the pi extension and
  Chrome extension can import.
- Since the Chrome extension is built with Vite and the pi extension runs in Node,
  a shared `protocol.ts` file copied or symlinked to both works.
- Package structure (monorepo):
  ```
  pi-browser-extension/
  ├── package.json              # Root monorepo config (npm workspace)
  ├── protocol/
  │   └── src/
  │       └── protocol.ts       # Shared types (no dependencies)
  ├── pi-extension/
  │   ├── package.json          # Dependencies: ws, @mariozechner/pi-coding-agent, typebox
  │   └── src/
  │       ├── index.ts          # Extension entry point
  │       ├── server.ts         # WebSocket server
  │       └── tools.ts          # Tool definitions
  ├── chrome-extension/
  │   ├── package.json          # Vite + React (or vanilla) for popup
  │   ├── vite.config.ts
  │   ├── manifest.json         # MV3 manifest
  │   └── src/
  │       ├── background/       # Service Worker (WS client, message routing)
  │       ├── content/          # Content script (DOM operations)
  │       └── popup/            # Optional popup UI
  └── README.md
  ```

---

## Non-Functional Requirements

| Category      | Requirement                                            | Target                      |
| ------------- | ------------------------------------------------------ | --------------------------- |
| Performance   | Tool round-trip latency (pi → browser → pi)            | < 500ms for click/type/read |
| Performance   | Screenshot capture + transfer                          | < 2s for viewport           |
| Reliability   | WebSocket reconnection after drop                      | < 5s to reconnect + retry   |
| Security      | All communication                                      | localhost only, no TLS      |
| Security      | Browser extension permissions                          | Minimal required set        |
| Usability     | Setup steps to working first tool call                 | < 5 minutes                 |
| Compatibility | Pi version                                             | Latest pi release           |
| Compatibility | Chrome version                                         | 120+ (MV3 required)         |
| Compatibility | Node version (for pi extension `ws` dep)               | 20+                         |

---

## Constraints

- **Technical:** Chrome extension must use Manifest V3 (MV2 is deprecated). Service
  worker must handle the short lifecycle (< 5 min idle timeout).
- **Technical:** Pi extension must use `ws` npm library (Node.js WebSocket server).
  Since pi uses `jiti` for TypeScript, the `ws` types must be resolvable.
- **Technical:** The Chrome extension cannot use Node.js APIs; it's a browser
  environment. Any shared code must be isomorphic or duplicated.
- **Project location:** New project at `~/w/marco-souza/pi-browser-extension`.
  Not part of the PodCodar webapp.
- **Timeline:** No hard deadline. v1 (P0 user stories) first, iterate from there.

---

## Dependencies

- **External:**
  - `ws` npm library (pi extension WebSocket server)
  - `@mariozechner/pi-coding-agent` (pi extension types)
  - `typebox` (tool parameter schemas, ships with pi)
  - `@crxjs/vite-plugin` or `vite-plugin-web-extension` (Chrome extension build)
- **Internal:** None. This is a greenfield project.
- **Pi itself:** Must be installed on the user's machine.

---

## Open Questions

- [ ] Should the Chrome extension popup have a visual element picker (click an
  element to get its selector) or is that v2? (Assumed: v2, headless-only for v1)
- [ ] Should the extension support `browser_exec` (execute arbitrary JS) in v1?
  (Assumed: P2 nice-to-have, deferred)
- [ ] Should the pi extension auto-start the WebSocket server on the default port,
  or require explicit configuration? (Assumed: auto-start on 9242, configurable
  via environment variable `PI_BROWSER_PORT`)
- [ ] Should we publish both as a single pi package `pi install npm:pi-browser-extension`
  that includes setup instructions for the Chrome side? Or keep them as separate repos?
  (Assumed: monorepo with clear separation; the pi package installs the pi extension
  only; the Chrome extension is loaded unpacked or via Web Store)
- [ ] What's the format for returning images to pi? Tool result `content` array with
  `{ type: "image", source: { type: "base64", mediaType: "image/png", data: "..." } }`?
  (Assumed: yes, following pi's image format from the SDK docs)

---

## Success Metrics

- **SM1:** A pi user can run `browser_navigate` + `browser_screenshot` within 5
  minutes of installing both extensions.
- **SM2:** The pi extension handles 100+ tool calls without dropping the WebSocket
  connection (measured in a single session).
- **SM3:** 90% of tool calls return in under 1 second (excluding navigate which
  depends on page load speed).
- **SM4:** The Chrome extension service worker survives Chrome's aggressive idle
  termination and reconnects transparently.

---

## Risks & Mitigations

| Risk                                                            | Impact | Likelihood | Mitigation                                                               |
| --------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------ |
| Chrome MV3 service worker lifetime kills WS connection          | High   | High       | Auto-reconnect with backoff; keep WS alive via periodic ping (every 20s) |
| `<all_urls>` permission scares users or gets rejected by CWS    | Medium | Medium     | Document clearly why it's needed; offer `activeTab`-only fallback mode   |
| `captureVisibleTab` can't do full-page screenshots natively     | Low    | Medium     | Scroll-and-stitch workaround; or accept viewport-only for v1             |
| Pi extension `ws` dependency breaks on older Node               | Low    | Low        | Pin `ws` version; test against Node 20+ (pi's documented requirement)    |
| Chrome extension content script injection fails on some pages   | Low    | Low        | Detect and return clear error; document known limitations                |
| User expects full automation (form filling, auth, cookies)      | Medium | Medium     | Scope clearly to practical subset; list non-goals prominently            |

---

## Appendix

### References

- [Pi Extensions Documentation](https://pi.dev) — extension API, tool registration, events
- [Pi Packages Documentation](https://pi.dev/docs/packages) — packaging and distribution
- [Antigravity Browser Extension](https://antigravity.google) — prior art, inspiration
- [Chrome Extension MV3 Migration Guide](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) — for full-page screenshots (future)

### Glossary

- **MV3:** Manifest V3 — the current Chrome extension manifest format. Requires
  service workers instead of persistent background pages.
- **Service Worker (SW):** Ephemeral background script in MV3. Chrome may terminate
  it after ~30 seconds of inactivity.
- **Content Script:** JavaScript injected into a web page by an extension. Has
  access to the DOM but runs in an isolated world.
- **Pi Package:** A distributable bundle of extensions, skills, prompts, and themes
  installable via `pi install`.
