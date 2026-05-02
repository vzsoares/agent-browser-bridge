# PRD: Production-Ready Refactoring — Clean Architecture + Test Coverage

**Status:** Draft
**Created:** 2026-05-02
**Author:** AI Agent (from discussion with marco)
**Version:** 1.1 — Updated after codebase review + clarification session

---

## Executive Summary

Refactor pi-browser-bridge from its current monolithic structure into a Clean Architecture codebase with test coverage on the chrome-extension side. The logger, Biome config, protocol tests, and pi-extension server/tool tests are already complete. The remaining work is promoting `waitForElement` and `waitForText` to first-class tools, extracting domain logic into testable layers, adding DOM tests for the chrome-extension content script, and setting up CI.

---

## Problem Statement

As of 2026-05-02, the following are **already done**:
- ✅ Logger (`@pi-browser-bridge/logger`) fully implemented with levels, env config, silent-by-default
- ✅ All `console.*` calls migrated across all packages — zero remain
- ✅ Biome configured with `noConsole` lint rule
- ✅ Protocol package has round-trip serialization tests
- ✅ pi-extension server tests (`server.test.ts`) — lifecycle, request/response correlation, subscriptions, disconnect handling
- ✅ pi-extension tool tests (`tools.test.ts`) — schema, validation, and integration tests for browser_navigate, browser_click, browser_type, browser_read, browser_screenshot, browser_exec
- ✅ E2E test suite (`pi-extension/src/__tests__/e2e.test.ts`, 1245 lines) — comprehensive real WebSocket + Chrome integration tests

### Browser Tools (8 Total)

| # | Tool | Protocol | Pi Tool | Content Script Handler | Status |
|---|------|----------|---------|------------------------|--------|
| 1 | `navigate` | ✅ | ✅ | ✅ | Existing, tested |
| 2 | `click` | ✅ | ✅ | ✅ | Existing, tested |
| 3 | `type` | ✅ | ✅ | ✅ | Existing, tested |
| 4 | `read` | ✅ | ✅ | ✅ | Existing, tested |
| 5 | `screenshot` | ✅ | ✅ | ⚠️ (handled by background, not content script) | Existing, tested |
| 6 | `exec` | ✅ | ✅ | ✅ | Existing, tested |
| 7 | `waitForElement` | ❌ → ✅ | ❌ → ✅ | ✅ (untested) | **New first-class tool** |
| 8 | `waitForText` | ❌ → ✅ | ❌ → ✅ | ✅ (untested) | **New first-class tool** |

> **Note:** `waitForElement` and `waitForText` already exist as content script handlers but were never exposed via the protocol's `Action` union or registered as pi tool definitions. They are promoted to first-class tools as part of this refactoring.
>
> **Note:** `screenshot` is handled entirely by the background service worker (`chrome.tabs.captureVisibleTab`). The content script's `screenshotHandler` returns `{ status: "not_implemented" }` and is dead code — it will be removed during layer extraction. See **Appendix B** for the split architecture detail.

**What remains unaddressed:**

1. **No architectural layering** — All packages use flat or feature-based file organization. Domain logic (error codes, param validation, allowlist matching, DOM helpers) is intermixed with infrastructure (Hono WebSocket, `chrome.tabs.*` APIs, pi `defineTool`). This makes the chrome-extension code untestable in isolation.
2. **Chrome extension content script is untested** — `chrome-extension/src/content/index.ts` (~1650 lines) has zero tests. It contains critical DOM interaction logic (element finding, clicking, typing, reading, waiting) that could silently regress.
3. **Chrome extension background service worker is untested** — `background.ts` (~600 lines) orchestrates browser actions and message dispatching with no test coverage.
4. **No happy-dom / Vitest setup** — Current tests use `bun:test` with real WebSocket connections. There's no DOM test environment for the chrome-extension's DOM helpers.
5. **No CI pipeline** — No automated typecheck, lint, test, or build gates on push/PR.
6. **No documented architecture** — No `STRUCTURE.md` explaining the codebase organization.

---

## Goals

- **G1: Clean Architecture layers** — Strict separation of domain (zero external deps), application (orchestration), infrastructure (Hono, Chrome APIs, pi tools), and adapters (pi/Chrome wiring), enforced at build-time via import rules
- **G2: Chrome extension test coverage** — happy-dom + Vitest tests for DOM helpers, action handlers, and WebSocket client logic. ≥ 80% line coverage on chrome-extension code
- **G3: CI pipeline** — `bun typecheck`, `bun lint`, and `bun test` run on every push and PR via GitHub Actions (E2E excluded — see FR-5)
- **G4: Zero regressions** — All existing tests pass. All 8 browser tools continue working exactly as before
- **G5: Documented architecture** — A `STRUCTURE.md` file explains the layer model and how to add new tools

---

## Non-Goals

- **NG1: No breaking API changes** — The WebSocket protocol types in `protocol/` are the contract. Existing Actions stay unchanged; `waitForElement` and `waitForText` are additive
- **NG2: No new feature logic** — This is a refactoring effort. `waitForElement` and `waitForText` already exist in the content script — we're promoting them, not building new behavior
- **NG3: No Chrome Store publishing** — Extension distribution mechanics are deferred
- **NG4: No rewrite from scratch** — We refactor in-place, extracting and layering existing code
- **NG5: No performance optimization** — Current performance is acceptable
- **NG6: No re-testing of already-tested code** — The pi-extension server tests, tool tests, and protocol tests are production-grade and will be preserved. The `bun:test` runner is kept (no migration to Vitest for existing tests)
- **NG7: No popup UI testing** — The chrome-extension popup is UI-only and deferred
- **NG8: No E2E in CI** — E2E tests require real Chrome and are a manual pre-merge gate only

---

## User Stories

### Must Have (P0)

- As a **developer**, I want the chrome-extension DOM logic tested so that I can refactor without breaking browser interactions.
- As a **developer**, I want clear architectural boundaries so that I can change a tool handler without touching infrastructure code.
- As a **developer**, I want my PR to fail CI if tests break or lint rules are violated so that regressions are caught before merge.
- As a **pi user**, I want all 8 browser tools to work exactly as before so that my workflows aren't disrupted.

### Should Have (P1)

- As a **contributor**, I want a documented architecture (`STRUCTURE.md`) so that I understand why the codebase is structured this way.
- As a **developer**, I want to add a new browser tool by writing only a domain handler + a single infrastructure adapter so that new tools take < 1 hour to implement.
- As a **developer**, I want build-time enforcement of layer boundaries so that accidental cross-layer imports are caught immediately.

### Nice to Have (P2)

- As a **developer**, I want mutation testing to verify test quality so that I know tests are meaningful.
- As a **developer**, I want benchmark tests for the WebSocket relay so that I can detect performance regressions.

---

## Functional Requirements

### FR-1: Clean Architecture — pi-extension
- System must reorganize existing code into four layers:
  - `domain/` — Error types (already defined in protocol), tool param schemas (Zod), allowlist logic, port interfaces (zero deps on Hono/ws/pi)
  - `application/` — One use case per tool (e.g., `NavigateUseCase`, `ClickUseCase`, `WaitForElementUseCase`, `WaitForTextUseCase`), message orchestration (`sendRequest`, `handleResponse`)
  - `infrastructure/` — Hono WebSocket server, `ws` connections, owner/client failover logic
  - `adapters/` — pi `ExtensionAPI` integration, tool definitions that wire application use cases to pi's `defineTool` (8 tool adapters, one per tool)
- `domain/` must have **zero imports** from external packages (only TypeScript built-ins and protocol types)
- Layer dependency chain: domain ← application ← infrastructure ← adapters
- Dependencies must be enforced at build-time (Biome `no-restricted-imports` or custom script)
- Existing tests (`server.test.ts`, `tools.test.ts`) must be adapted to the new structure and continue passing
- Two new pi tool files must be created: `browser-wait-for-element.ts` and `browser-wait-for-text.ts`

### FR-2: Clean Architecture — chrome-extension
- System must reorganize existing code into three layers:
  - `domain/` — DOM helpers (`waitForElement`, `waitForText`, `extractText`), error types, allowlist matching, element interaction logic
  - `application/` — Action handlers (`handleNavigate`, `handleClick`, `handleScreenshot`, etc.), message dispatching
  - `infrastructure/` — WebSocket client to Bun server, Chrome extension API calls (`chrome.tabs.*`, `chrome.storage.*`), content script message listeners, service worker background
- `domain/` DOM helpers must be testable with happy-dom (no Chrome API dependencies)
- Content script must continue to be auto-injected via manifest (single entry point in build output)

### FR-3: Test Infrastructure
- System must use **happy-dom** for DOM-based unit tests in the chrome-extension
- System must use **Vitest** as the test runner for chrome-extension tests (consistent with workspace convention)
- Existing pi-extension tests continue using `bun:test` — no migration needed
- System must provide mock/fake implementations for: `WebSocket`, `chrome.tabs.*`, `chrome.storage.*`, `chrome.runtime.onMessage`
- System must support `bun test` from the root (monorepo-aware) — runs existing `bun:test` suites
- System must support `bun run test:vitest` for chrome-extension happy-dom tests
- System must have a Vitest setup file that configures happy-dom globally for chrome-extension tests
- Existing `pi-extension/src/__tests__/e2e.test.ts` (1245 lines) is **preserved as-is** (only import paths updated during refactoring). It is **not** run in CI.

### FR-4: Chrome Extension Test Coverage
- **chrome-extension/domain/** — `waitForElement` (3+ scenarios), `waitForText` (3+ scenarios), `clickHandler` (found, not-found, not-interactable, navigated), `typeHandler` (input, textarea, contenteditable, React-native-setter), `readHandler`/`extractText` (simple, nested, truncated)
- **chrome-extension/application/** — Message dispatcher tests, `forwardToContentScript` retry logic tests, action handler orchestration tests
- **chrome-extension/infrastructure/** — WebSocket reconnect tests (mocked), Chrome API interaction tests (mocked), service worker message routing tests
- **E2E (local only)** — Full bridge smoke test using existing `pi-extension/src/__tests__/e2e.test.ts` (verify all 8 tools end-to-end). **Not executed in CI.**

### FR-5: CI Pipeline
- System must run `bun typecheck`, `bun lint`, and `bun test` on every push to `main`
- System must run the same checks on pull requests
- System must fail the build on any test failure, lint error, or type error
- CI must be configured via GitHub Actions (`.github/workflows/ci.yml`)
- **CI must NOT run E2E tests** — no headless Chrome, Puppeteer, or Playwright in CI. E2E tests (`e2e.test.ts`) are a manual pre-merge gate only.
- CI scope: `protocol` tests, `pi-extension` tests (`server.test.ts`, `tools.test.ts`), `chrome-extension` Vitest tests (happy-dom, mocked DOM)

### FR-6: Developer Experience
- System must provide `bun run test` and `bun run test:watch` scripts in root package.json
- System must provide a `bun run lint` script (Biome already configured)
- System must document the architecture in a `STRUCTURE.md` file at the root

---

## Non-Functional Requirements

| Category       | Requirement                              | Target            |
|----------------|------------------------------------------|-------------------|
| Performance    | WebSocket relay latency                  | < 50ms p95        |
| Reliability    | Tests pass deterministically             | No flaky tests    |
| Reliability    | WebSocket reconnect after owner restart  | < 1 second        |
| Security       | No secrets in test code                  | Zero hardcoded    |
| Test Coverage  | chrome-extension domain layer            | ≥ 90% line        |
| Test Coverage  | chrome-extension application layer       | ≥ 80% line        |
| Test Coverage  | chrome-extension infrastructure (mocked) | ≥ 60% line        |
| Build          | Chrome extension Vite build              | Succeeds without warnings |
| Compatibility  | All 8 browser tools                      | No behavioral changes |

---

## Constraints

- **Technical:** Must remain a Bun workspace monorepo with ESM modules
- **Technical:** Protocol types in `protocol/` are the public contract — `Action` union must be extended to include `waitForElement` and `waitForText` (additive, backward-compatible)
- **Technical:** Chrome extension must remain Manifest V3
- **Technical:** Layer boundaries must be enforced at build-time — `domain/` must not import from `infrastructure/` or `adapters/`
- **Technical:** Existing pi-extension tests (`bun:test`) must be preserved and continue passing
- **Timeline:** No hard deadline; prioritize correctness over speed
- **Refactoring approach:** Incremental PRs — one vertical slice per PR. Shared infrastructure extracted first, then tools one at a time end-to-end
- **Vitest config:** Root-level workspace config (`vitest.config.ts` at monorepo root), per-package overrides when needed
- **CI scope:** Unit + integration tests only. No E2E/headless Chrome in CI.

---

## Dependencies

- **Internal:** Vitest and happy-dom must be added as devDependencies to the monorepo
- **Internal:** Biome must be updated with `no-restricted-imports` rules for layer enforcement
- **Internal:** Protocol `Action` union and `ActionParams` must be extended with `waitForElement` and `waitForText` (interfaces already exist)
- **External:** GitHub Actions for CI (free tier is sufficient)

---

## Open Questions

All open questions have been resolved:

- [x] **E2E in CI:** E2E smoke tests run locally only. CI runs unit + integration tests. **Decision: local-only.**
- [x] **Vitest config location:** Root-level workspace config (`vitest.config.ts` at monorepo root) with per-package overrides. **Decision: root workspace.**
- [x] **Refactoring strategy:** Incremental PRs — one vertical slice per PR. Shared infrastructure first, then tools one at a time. **Decision: incremental PRs.**
- [x] **Tool count:** 8 browser tools. `waitForElement` and `waitForText` promoted from internal content script helpers to first-class tools (protocol + pi tool definitions + tests). **Decision: promote to first-class.**

---

## Success Metrics

- **Metric 1:** `bun test` passes with ≥ 80% overall line coverage on chrome-extension code
- **Metric 2:** All existing pi-extension and protocol tests continue passing
- **Metric 3:** CI pipeline runs and passes on every PR
- **Metric 4:** All 8 browser tools pass E2E smoke tests locally against `e2e.test.ts`
- **Metric 5:** A new developer can add a 9th tool in < 1 hour by following documented patterns in `STRUCTURE.md`

---

## Risks & Mitigations

| Risk                                    | Impact | Likelihood | Mitigation                         |
|-----------------------------------------|--------|------------|------------------------------------|
| Refactoring breaks existing tool behavior | High   | Medium     | E2E smoke tests verify each tool before and after refactoring |
| Chrome extension APIs are hard to mock  | Medium | Medium     | Use a typed mock wrapper; test domain logic without Chrome APIs |
| Test flakiness from async DOM operations | Medium | Medium     | Deterministic happy-dom environment; avoid real-time sleeps |
| Scope creep (adding features during refactoring) | Medium | High | Strict non-goals enforcement; defer new features to separate PRDs |
| Adapting existing tests to new architecture is more work than expected | Medium | Medium | Preserve existing test logic; only update import paths and test structure |
| Vite build complexity with multi-layer chrome-extension | Medium | Low | Keep single content script entry point; internal layers are build-time only |
| `@crxjs/vite-plugin` incompatibility with layered source structure | Medium | Low | Test early with a single slice; fall back to pre-build flattening if needed |

---

## Appendix

### Appendix A: Protocol Changes Required

The `protocol/` package must be updated to add two new actions and their param interfaces:

```ts
// Add to Action union:
export type Action =
  | "navigate" | "click" | "type" | "screenshot" | "read" | "exec"
  | "waitForElement"  // NEW
  | "waitForText";    // NEW

// Add to ActionParams:
export interface ActionParams {
  // ... existing ...
  waitForElement: WaitForElementParams;  // already defined
  waitForText: WaitForTextParams;        // already defined
}
```

Both `WaitForElementParams` and `WaitForTextParams` interfaces already exist in the protocol — only the union types need extending. This is a backward-compatible additive change.

### Appendix B: Screenshot Architecture Clarification

The `screenshot` tool has a **split architecture**:
- **Background service worker** handles the actual capture via `chrome.tabs.captureVisibleTab` — this is the production path.
- **Content script** `screenshotHandler` is a stub (`{ status: "not_implemented" }`) and will be removed during refactoring.
- The pi-extension routes `screenshot` actions directly to the background handler, bypassing the content script.

During layer extraction, the screenshot domain logic (URL restriction checks, format/quality validation) should be moved to `chrome-extension/domain/`, the capture orchestration to `application/`, and the `chrome.tabs.captureVisibleTab` call to `infrastructure/`.

### References
- `logger/src/index.ts` — existing logger implementation (complete)
- `biome.json` — existing Biome config (complete)
- `pi-extension/src/__tests__/server.test.ts` — existing server tests (preserve)
- `pi-extension/src/__tests__/tools.test.ts` — existing tool tests (preserve)
- `pi-extension/src/__tests__/e2e.test.ts` — existing E2E test suite (preserve, local-only)
- `protocol/src/__tests__/protocol.test.ts` — existing protocol tests (preserve)
- `docs/PRD-multi-instance.md` — multi-instance failover design
- `tasks.json` — legacy logger migration tasks (all completed, can be archived)

### Glossary
- **pi:** The [pi coding agent](https://github.com/mariozechner/pi) — terminal-based AI coding assistant
- **Owner/Client mode:** pi-extension server topology where one instance binds the port (owner) and others connect as clients
- **Content script:** JavaScript injected by the Chrome extension into every web page
- **Service worker:** Background script in Chrome Extension Manifest V3 that manages extension lifecycle
- **Vertical slice:** A refactoring approach that extracts one complete feature end-to-end (domain → application → infrastructure → adapters) before moving to the next
- **happy-dom:** A lightweight DOM implementation for testing browser code in Node.js

### Current File Inventory

| File | Lines | Risk Level | Status |
|------|-------|------------|--------|
| `chrome-extension/src/content/index.ts` | ~1650 | Critical | ❌ Untested, monolithic — P0 refactoring target. Contains dead `screenshotHandler` stub. |
| `chrome-extension/src/background/background.ts` | ~600 | High | ❌ Untested, monolithic — P1 refactoring target. Handles screenshot directly. |
| `pi-extension/src/server.ts` | ~500 | High | ✅ Tested (server.test.ts), needs layer extraction |
| `pi-extension/src/tools/*.ts` | ~200 each (×6) | Medium | ✅ Tested (tools.test.ts), needs layer extraction + 2 new tool files |
| `pi-extension/src/index.ts` | ~200 | Medium | ⚠️ Needs adapter extraction |
| `pi-extension/src/__tests__/e2e.test.ts` | 1245 | High | ✅ Comprehensive E2E, preserved (import paths updated), **local-only** |
| `protocol/src/protocol.ts` | ~150 | Low | ✅ Clean, tested — Action union needs 2 additions |
| `logger/src/index.ts` | ~100 | Low | ✅ Complete |
