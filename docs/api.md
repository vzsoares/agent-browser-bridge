# API Reference

Full reference for all 8 browser tools, error codes, and the WebSocket protocol.

## Tools

### `browser_navigate`

Navigate the active tab to a URL.

```ts
browser_navigate({ url: "https://example.com" })
browser_navigate({ url: "https://app.example.com", waitUntil: "networkidle", timeout: 15000 })
```

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `url` | string | ✅ | — | Fully-qualified URL |
| `waitUntil` | `"load"` \| `"domcontentloaded"` \| `"networkidle"` | — | `"load"` | When to consider navigation complete |
| `timeout` | integer | — | `30000` | Max wait time (ms) |

**Returns:** `Navigated to: <url>\nPage title: <title>`

> **v1 limitation:** `waitUntil` is only fully supported for same-page (hash) navigations. Cross-page navigations always wait for `window.load`.

---

### `browser_screenshot`

Capture a screenshot of the current tab.

```ts
browser_screenshot({})
browser_screenshot({ format: "jpeg", quality: 90, fullPage: true })
```

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `format` | `"png"` \| `"jpeg"` | — | `"png"` | Image format |
| `quality` | integer (0–100) | — | `80` | JPEG quality (ignored for PNG) |
| `fullPage` | boolean | — | `false` | Full-page capture |

**Returns:** Base64-encoded image content block + optional warning for v1 limitations.

> **v1 limitation:** `fullPage: true` captures only the visible viewport.

---

### `browser_read`

Extract visible text from the page. Preserves structure: headings, paragraphs, links, buttons, inputs, images (alt text). Hidden elements, `<script>`, and `<style>` are excluded.

```ts
browser_read({})
browser_read({ selector: "article.main-content" })
browser_read({ maxLength: 1000 })
```

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `selector` | string | — | `"body"` | CSS selector to scope the read |
| `maxLength` | integer | — | `50000` | Truncate text beyond this length |

**Returns:** Structured text with `[truncated — N chars total]` note when cut off.

---

### `browser_click`

Click an element by CSS selector, with optional text disambiguation.

```ts
browser_click({ selector: "#submit-btn" })
browser_click({ selector: "button", text: "Save" })
browser_click({ selector: ".modal .confirm", timeout: 5000 })
```

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `selector` | string | ✅ | — | CSS selector |
| `text` | string | — | — | Text the element must contain (case-insensitive, fuzzy) |
| `timeout` | integer | — | `10000` | Max wait time (ms) |

**Returns:** `Clicked element "<selector>"\nElement text: "<text>"` + navigation info if the click caused a page change.

**Error behavior:** When no element matches, returns a list of suggested matches with their text contents.

---

### `browser_type`

Type text into an input, textarea, or contenteditable element. Dispatches `input` and `change` events for framework compatibility (React, Vue, Svelte).

```ts
browser_type({ selector: "#email", text: "user@example.com" })
browser_type({ selector: "#search", text: " query", clear: false })
browser_type({ selector: "#message", text: "Hello!", submit: true })
```

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `selector` | string | ✅ | — | CSS selector of the input |
| `text` | string | ✅ | — | Text to type |
| `clear` | boolean | — | `true` | Clear existing value first |
| `submit` | boolean | — | `false` | Press Enter / submit form after typing |
| `timeout` | integer | — | `10000` | Max wait time (ms) |

**Returns:** `Typed into "<selector>" (current value: "<text>")`

---

### `browser_wait_for_element`

Wait for an element matching a CSS selector to appear in the DOM.

```ts
browser_wait_for_element({ selector: ".modal" })
browser_wait_for_element({ selector: "#result", timeout: 15000 })
```

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `selector` | string | ✅ | — | CSS selector to wait for |
| `timeout` | integer | — | `10000` | Max wait time (ms) |

**Returns:** `Element "<selector>" (<tagName>) found in <N>ms.`

---

### `browser_wait_for_text`

Wait for specific text to appear on the page. Case-sensitive.

```ts
browser_wait_for_text({ text: "Welcome" })
browser_wait_for_text({ text: "Success", scope: "#notifications", timeout: 5000 })
```

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `text` | string | ✅ | — | Case-sensitive text to wait for |
| `scope` | string | — | — | CSS selector to limit search area |
| `timeout` | integer | — | `10000` | Max wait time (ms) |

**Returns:** `Text "<text>" found in <N>ms.`

---

### `browser_exec`

Execute arbitrary JavaScript in the page context. Async code is auto-awaited with a 5s timeout. Output capped at 10,000 characters.

```ts
browser_exec({ code: "document.title" })
browser_exec({ code: "document.querySelectorAll('a').length" })
browser_exec({ code: "fetch('/api/status').then(r => r.json())" })
```

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `code` | string | ✅ | — | JavaScript code to execute |

**Returns:** Serialized value (JSON for objects, `[Function: name]` for functions, `[Circular]` for cycles).

> ⚠️ **Security:** This tool executes arbitrary code in the page context. Only use on trusted pages. The content script runs in an isolated world and does not expose extension internals to the page.

---

## Error Handling

Every error response is a structured object:

```ts
interface ErrorResponse {
  code: ErrorCode;     // Machine-readable code
  message: string;     // Human-readable description
  suggestion?: string; // Actionable hint for the LLM to self-correct
}
```

### Error codes

| Code | Meaning | What to do |
|---|---|---|
| `TIMEOUT` | Request exceeded timeout (default: 30s) | Increase `timeout` parameter; wait for page to load first |
| `ELEMENT_NOT_FOUND` | No element matched the CSS selector | Check selector; use `browser_read` to inspect the page; suggestions are included in error |
| `ELEMENT_NOT_INTERACTABLE` | Element exists but is hidden, disabled, or read-only | Wait for visibility; use a different selector |
| `ELEMENT_NOT_TYPABLE` | Element is not an input, textarea, or contenteditable | Use a selector targeting `<input>`, `<textarea>`, or `[contenteditable="true"]` |
| `INVALID_URL` | URL is malformed or missing | Provide a fully-qualified URL: `https://example.com/path` |
| `RESTRICTED_URL` | URL uses a blocked scheme (`chrome://`, `edge://`, etc.) | Use `https://` URLs |
| `RESTRICTED_DOMAIN` | Domain not in the allowlist | Add the domain to the popup allowlist or set it to `*` |
| `BROWSER_NOT_CONNECTED` | No Chrome extension connected | Install/check the extension; verify the icon shows green |
| `CONNECTION_RESET` | WebSocket connection lost during request | Auto-retries (up to 3 attempts); restart extension if persistent |
| `UNKNOWN_ACTION` | Action not recognised or payload malformed | Check against supported actions |

---

## WebSocket Protocol

The bridge MCP server runs a WebSocket server. The Chrome extension connects as a client. Messages are JSON with request/response correlation via `id`.

### Request (bridge → browser)

```json
{
  "id": "req-1",
  "action": "navigate",
  "params": { "url": "https://example.com", "waitUntil": "load", "timeout": 30000 }
}
```

### Success response (browser → pi)

```json
{
  "id": "req-1",
  "result": { "url": "https://example.com", "title": "Example Domain" }
}
```

### Error response (browser → pi)

```json
{
  "id": "req-1",
  "error": {
    "code": "TIMEOUT",
    "message": "Page load timed out after 30s",
    "suggestion": "Try increasing the timeout parameter."
  }
}
```

### Action routing

| Action | Handled by | Notes |
|---|---|---|
| `navigate` | Service worker | Cross-page: `chrome.tabs.update`; same-page: forwarded to content script |
| `screenshot` | Service worker | Uses `chrome.tabs.captureVisibleTab` |
| `click` | Content script | DOM query + `.click()` with interactability checks |
| `type` | Content script | Native value setter + `input`/`change` event dispatch |
| `read` | Content script | Recursive DOM walk with text extraction |
| `exec` | Content script | `eval()` in isolated world with 5s timeout |
| `waitForElement` | Content script | MutationObserver + 100ms polling fallback |
| `waitForText` | Content script | `textContent` polling at 100ms intervals |

---

## Known Limitations (v1)

| Limitation | Details | Workaround |
|---|---|---|
| `waitUntil` for cross-page navigation | `domcontentloaded` and `networkidle` only work for same-page navigations | Use `browser_wait_for_element` or `browser_wait_for_text` after navigation |
| Full-page screenshots | `fullPage: true` captures only the visible viewport | Scroll manually and take multiple screenshots, or use `browser_exec` |
| No multi-tab orchestration | Only the active tab is controlled | Switch tabs manually in Chrome |
| No iframe support | `read`, `click`, and `type` don't traverse into iframes | Use `browser_exec` to access iframe content |
| No drag-and-drop | Not implemented | Use `browser_exec` to dispatch drag events |
| No cookie/session management | Not implemented | Handle auth outside the bridge or via `browser_exec` |
| Chrome-only | MV3 extension targets Chrome 120+ | Architecture permits other browsers in future versions |
