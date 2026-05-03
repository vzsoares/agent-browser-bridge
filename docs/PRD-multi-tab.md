# PRD: Multi-Tab Browser Bridge

**Status:** Implemented
**Created:** 2026-05-03
**Implemented:** 2026-05-03
**Author:** AI Agent (from discussion with marco-souza)
**Version:** 2.0

---

## Executive Summary

Add multi-tab support to the pi-browser-bridge so multiple pi coding agents can
operate simultaneously in separate browser tabs within a shared window. Each
agent targets its own tab via explicit `tabId`, eliminating race conditions
while preserving the existing single-tab workflow for backward compatibility.

---

## Problem Statement

Today, the pi-browser-bridge only operates on the **active tab** in the
**current window**. When multiple pi agents run in parallel (supported since
the multi-instance feature), they all fight over the same tab:

- Agent A navigates to GitHub while Agent B tries to read a page — Agent B
  reads from whatever tab is currently active, which Agent A may have changed
- If the user clicks a different tab, *all* agents suddenly target that tab
- Agents cannot work on multiple pages simultaneously
- Agents cannot create new tabs for subtasks (e.g., open a link in a new tab
  and read it)

Users currently work around this by ensuring only one pi instance runs at a
time, defeating the purpose of the multi-instance feature.

---

## Goals

- **Goal 1:** Each pi agent can be assigned its own tab and operate
  independently without interfering with other agents or the user
- **Goal 2:** Pi agents can create, list, and close tabs programmatically
- **Goal 3:** Breaking change accepted — `navigate` without `tabId` creates a
  new tab. Existing scripts that rely on in-place navigation must pass
  `tabId` explicitly.
- **Goal 4:** Multi-agent and single-agent workflows share the same Chrome
  extension — no duplicate infrastructure

---

## Non-Goals

- ❌ Separate browser windows per agent (screenshots don't work on background windows)
- ❌ Tab ownership / locking system (agents coordinate via explicit `tabId`)
- ❌ Cross-machine relay (localhost only, same as today)
- ❌ Tab grouping or visual management UI beyond the extension popup
- ❌ Screenshot support for background tabs (Chrome API limitation —
  `captureVisibleTab` only captures the focused window's active tab)

---

## User Stories

### Must Have (P0)

- As a pi user running multiple agents, I want each agent to operate in its
  own tab so that they don't interfere with each other's work.
- As a pi agent, I want to create a new tab and navigate to a URL so that
  I can work on a page without disrupting the user's active tab.
- As a pi agent, I want to specify which tab to target for each action
  (click, type, read, exec, etc.) so that I control exactly where I operate.
- As a pi user, I want my existing single-tab workflow to keep working
  without any changes so that I don't need to update my scripts or config.

### Should Have (P1)

- As a pi agent, I want to list all open tabs so that I can find a tab I
  previously opened or identify the user's active tab.
- As a pi agent, I want to close a tab I created so that I don't leave
  clutter behind.
- As a pi user, I want the extension popup to show which tabs are being
  controlled by pi agents so that I know what's happening.

### Nice to Have (P2)

- As a pi agent, I want to find a tab by URL pattern so that I can locate
  a tab without knowing its `tabId`.
- As a pi user, I want to pin agent tabs so they don't get accidentally
  closed.

---

## Functional Requirements

### FR-1: Tab-Targeted Actions
- All existing actions (`click`, `type`, `read`, `exec`, `waitForElement`,
  `waitForText`) must accept an optional `tabId: number` parameter.
- When `tabId` is provided, the action targets that specific tab regardless
  of which tab is active.
- When `tabId` is omitted, the action targets the active tab in the current
  window (backward compatible with current behavior).
- If the specified `tabId` does not exist or is closed, return
  `TAB_NOT_FOUND` with a message indicating the tab is gone.
- Content script must be auto-injected into the target tab if not already
  present (reusing existing `forwardToContentScript` retry logic).

### FR-2: Tab Creation
- New action: `createTab` with params:
  - `url?: string` — URL to navigate to (opens blank tab if omitted)
  - `active?: boolean` — whether to make the new tab active (default: `false`)
- Returns: `{ tabId: number, url: string, title: string }`
- If `url` is provided, wait for navigation to complete before returning
  (same `waitUntil` and `timeout` semantics as `navigate`).
- Content script must be injected into the new tab before returning.

### FR-3: Tab Listing
- New action: `listTabs` with params:
  - `urlPattern?: string` — filter tabs by URL substring (optional)
  - `currentWindowOnly?: boolean` — limit to current window (default: `true`)
- Returns: `Array<{ tabId: number, url: string, title: string, active: boolean }>`
- Must exclude restricted URLs (`chrome://`, `about://`, extension pages).

### FR-4: Tab Closing
- New action: `closeTab` with params:
  - `tabId: number` — tab to close (required)
- Returns: `{ closed: true }` on success.
- If the tab doesn't exist, return `TAB_NOT_FOUND`.

### FR-5: Navigate Behavior Change
- When `navigate` is called **without** a `tabId`, the system must create
  a **new tab** and navigate there.
- When `tabId` is explicitly provided, navigate that tab in-place.
- **Rationale:** In a multi-agent world, agents should not hijack the user's
  active tab by default. They should create their own workspace.
- **Breaking change:** Existing scripts that call `navigate` without `tabId`
  will get a new tab instead of navigating in-place. Agents must pass
  `tabId` explicitly to navigate an existing tab.

### FR-6: Screenshot Limitation
- `screenshot` continues to use `chrome.tabs.captureVisibleTab()` — it
  captures the active tab in the focused window.
- A `tabId` parameter on `screenshot` is **not supported** in this phase
  because Chrome's API cannot screenshot background tabs.
- If `screenshot` is called with `tabId`, return an error with a suggestion
  to bring the tab to front first.

### FR-7: Tab Resolution in Message Router
The message router must resolve the target tab for each request:

```
Request arrives
  → has tabId?
    → yes → validate tab exists → use it
    → no → action is "navigate"?
      → yes → create new tab, use its tabId
      → no → use activeTabId.current (backward compat)
```

- Tab validation: `chrome.tabs.get(tabId)` — if it fails, reject with
  `TAB_NOT_FOUND`.
- Allowlist check uses the target tab's URL (not just the active tab).

### FR-8: Response Metadata
- Every `Response` must include the `tabId` of the tab that was operated on.
- For `createTab`, the returned `tabId` is the newly created tab.
- For actions without explicit `tabId`, the `tabId` reflects whichever tab
  was resolved (active tab or newly created tab).
- Response shape: `{ id: string, result: { ..., tabId: number }, error?: ... }`

### FR-9: Content Script Lifecycle
- Content scripts must be injected into newly created tabs before any
  actions are sent to them.
- `ensureContentScript(tabId)` must handle tabs that were just created
  (may require a brief delay for the tab to be ready for scripting).
- If a tab is closed mid-action, fail gracefully with `TAB_NOT_FOUND`.

---

## Non-Functional Requirements

| Category       | Requirement                              | Target              |
|----------------|------------------------------------------|---------------------|
| Performance    | Tab creation + navigation round-trip     | < 2s (page dependent)|
| Performance    | Tab resolution overhead per request      | < 5ms               |
| Reliability    | No crashes when tab closes mid-action    | 100%                |
| Reliability    | Content script injection success rate    | > 99%               |
| Scalability    | Concurrent tabs controlled simultaneously| No hard limit (tested with 5) |
| Compatibility  | `navigate` without `tabId`               | Breaking change — creates new tab instead of navigating active tab |
| Security       | Restricted URL protection                | Same as current allowlist + restricted URL checks |

---

## Constraints

- **Technical:** Must use Chrome Extension Manifest V3 APIs. No DevTools
  Protocol (too heavy, breaks MV3 compatibility).
- **Chrome API limitation:** `chrome.tabs.captureVisibleTab()` only works
  on the focused window's active tab — cannot screenshot background tabs.
- **Permissions:** Manifest must add `tabs` permission to reliably query,
  create, and close tabs from the background service worker.
- **Content script scope:** Per-tab, per-origin. Cross-origin iframes may
  not be accessible.
- **MV3 service worker:** Sleeps after inactivity — must handle wake-up
  scenarios gracefully (lazy-resolve tab state on each request).

---

## Dependencies

- **Internal:** Multi-instance feature (already implemented — client/owner
  relay architecture in `ws-server.ts` and `ws-transport.ts`).
- **Internal:** Existing `forwardToContentScript(tabId, request)` already
  supports arbitrary tab IDs — no changes needed there.
- **Internal:** `chrome-tabs.ts` already has `getTab(tabId)` — needs new
  functions for create/list/close.
- **External:** `@types/chrome` must include `chrome.tabs` APIs.

---

## Decisions (Resolved via grill-me session)

| # | Question | Decision |
|---|----------|----------|
| 1 | `navigate` default without `tabId` | **Create new tab** — no `reuseActiveTab` flag needed |
| 2 | Include `tabId` in responses | **Yes** — every response carries the operated tabId |
| 3 | Error code for closed/missing tabs | **New `TAB_NOT_FOUND`** — precise programmatic handling |
| 4 | Extension popup shows controlled tabs | **Yes, in v1** — users see agent tab assignments immediately |

---

## Success Metrics

- **Metric 1:** Multiple pi agents can operate in separate tabs simultaneously
  without interference (zero cross-tab race conditions in tests)
- **Metric 2:** Existing single-tab tests pass without modification
- **Metric 3:** Tab creation → action round-trip completes within 2s for
  simple pages
- **Metric 4:** Mutation test coverage remains above current threshold

---

## Risks & Mitigations

| Risk                                    | Impact | Likelihood | Mitigation                         |
|-----------------------------------------|--------|------------|------------------------------------|
| `navigate` breaking change breaks existing scripts | Medium | Medium | Document clearly; agents pass `tabId` from `listTabs` or `createTab` |
| Content script injection fails on new tabs | Medium | Low | Add retry with backoff; wait for `DOMContentLoaded` before injecting |
| Tab closes while action is in-flight | Low | Medium | `TAB_NOT_FOUND` error response; pi agent recreates tab |
| MV3 service worker sleeps and loses tab state | Low | Low | Re-query tab state on wake; `activeTabId` is lazy-resolved |
| User accidentally closes an agent's tab | Medium | High | `TAB_NOT_FOUND` error; pi agent detects and recreates the tab |
| `tabs` permission raises user privacy concerns | Low | Low | Document why it's needed; no host permissions added |

---

## Appendix

### References
- Existing multi-instance PRD: `docs/PRD-multi-instance.md`
- Current protocol: `protocol/src/protocol.ts`
- Message router: `chrome-extension/src/infrastructure/message-router.ts`
- Chrome tabs API: `chrome-extension/src/infrastructure/chrome-tabs.ts`

### Glossary
- **Owner:** Pi instance that runs the WebSocket server and connects to the Chrome extension.
- **Client:** Pi instance that connects to the owner and routes requests through it.
- **Active tab:** Tab currently focused in the current browser window.
- **tabId:** Chrome's unique numeric identifier for a browser tab.
- **Content script:** JS injected into a web page by the extension to interact with the DOM.
