# PRD: Proper Logger for pi-browser-bridge

**Status:** Draft
**Created:** 2026-05-02
**Author:** AI Agent
**Version:** 1.0

---

## Executive Summary

Replace ad-hoc `console.log/warn/error` calls in `pi-browser-bridge` with a proper shared logger. The logger is **silent by default** to keep pi's TUI clean, and can be enabled via an environment variable for debugging. Delivered as a new monorepo workspace package `@agent-browser-bridge/logger`.

---

## Problem Statement

`pi-extension` and the root `index.ts` currently use `console.*` for operational logging. These messages stream directly into pi's interactive TUI, creating visual noise for users who just want to see agent reasoning and tool results. There is no way to opt-out, filter by severity, or redirect logs elsewhere.

**Pain points:**
- `server.ts` alone has ~30 `console.*` statements that fire on every connection, disconnection, retry, and failover event
- pi's TUI output gets interleaved with `[bridge] ...` diagnostic lines
- No log levels — everything is always visible or not
- Chrome extension background/content scripts also log to the browser console indiscriminately

---

## Goals

- **Goal 1:** Provide a shared logger with levels (`debug`, `info`, `warn`, `error`) that is **silent by default**
- **Goal 2:** Allow developers to enable logging via an environment variable (`PI_BROWSER_BRIDGE_LOG_LEVEL`)
- **Goal 3:** Replace all `console.*` calls in `pi-extension`, root `index.ts`, and `chrome-extension` with the new logger
- **Goal 4:** Package the logger as a new monorepo workspace so all internal packages can depend on it

---

## Non-Goals

- **Non-Goal 1:** Log rotation, log files, or structured JSON output — `stdout`/`stderr` is enough for now
- **Non-Goal 2:** Browser DevTools integration (e.g., `console.group`, styled output) — plain text is fine
- **Non-Goal 3:** Replace pi's own internal logging or any third-party library logs
- **Non-Goal 4:** A CLI flag like `--verbose`; env-var only is sufficient

---

## User Stories

### Must Have (P0)

- As a pi user, I want the browser bridge to be silent during normal operation so that pi's TUI stays clean and readable.
- As a developer debugging bridge issues, I want to set `PI_BROWSER_BRIDGE_LOG_LEVEL=debug` to see all WebSocket lifecycle messages so that I can diagnose connection or failover problems.
- As a contributor, I want a single `import { logger } from '@agent-browser-bridge/logger'` to use in any workspace package so that logging is consistent.

### Should Have (P1)

- As a developer, I want log output to include timestamps and severity so that I can trace event ordering.

### Nice to Have (P2)

- As a developer, I want `PI_BROWSER_BRIDGE_LOG_LEVEL` to support `silent` explicitly (in addition to missing/empty) so that I can be explicit about disabling logs.

---

## Functional Requirements

### FR-1: Logger Package

- A new workspace package `@agent-browser-bridge/logger` is created under `logger/`
- It exports a default `logger` object and named `createLogger(namespace)` factory
- Zero runtime dependencies
- TypeScript types included

### FR-2: Log Levels

- Supported levels: `debug` < `info` < `warn` < `error`
- Default level when env var is absent/empty: `silent` (no output)
- Level is read from `process.env.PI_BROWSER_BRIDGE_LOG_LEVEL` at import time
- Unknown level values fall back to `silent`

### FR-3: Output Format

- Format: `[<timestamp> <LEVEL> <namespace>] <message>`
- `timestamp` in ISO 8601 or `HH:MM:SS` format
- `namespace` defaults to `pi-browser-bridge` but can be overridden per-logger instance
- Multi-argument calls (`logger.info("a", "b")`) are space-joined like `console.log`

### FR-4: API Surface

```typescript
interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

// Default shared instance
export const logger: Logger;

// Create a namespaced instance
export function createLogger(namespace: string): Logger;
```

### FR-5: Migration Scope

Replace `console.*` in these files:

| File | Current calls |
|------|---------------|
| `index.ts` | `console.log` × 2 |
| `pi-extension/src/server.ts` | `console.log`, `warn`, `error` × ~30 |
| `chrome-extension/src/background/background.ts` | `console.log`, `warn`, `error` × 3 |
| `chrome-extension/src/content/index.ts` | `console.log`, `warn`, `error` × ~10 |
| `chrome-extension/src/popup/index.ts` | `console.log`, `error` × ~5 |

The `chrome-extension` package can optionally keep using raw `console.*` since browser extension output doesn't reach pi's TUI, but **migrating it anyway keeps the codebase consistent**.

### FR-6: Package Wiring

- Root `package.json` workspaces array includes `"logger"`
- `pi-extension/package.json` adds `"@agent-browser-bridge/logger": "workspace:*"` to dependencies
- `chrome-extension/package.json` adds `"@agent-browser-bridge/logger": "workspace:*"` to dependencies

---

## Non-Functional Requirements

| Category       | Requirement                                           | Target         |
|----------------|-------------------------------------------------------|----------------|
| Performance    | No I/O or string formatting when level is `silent`    | < 1µs no-op    |
| Bundle Size    | Logger source should be tiny (no deps)                | < 200 bytes    |
| Compatibility  | Works in Node.js (pi-extension) and browser (chrome-ext) | Both OK       |

---

## Constraints

- **Technical:** Must work in both Node.js and browser contexts (chrome extension)
- **Timeline:** Small feature, single PR
- **Stack:** TypeScript, ESM, Bun workspaces — no external logging libraries

---

## Dependencies

- **Internal:** New `logger` workspace package must exist before migration
- **External:** None

---

## Open Questions

- [ ] Should `chrome-extension` migrate to the new logger or keep `console.*`? *(Assumption: migrate for consistency)*
- [ ] Should the logger prefix include the package name (e.g., `[pi-extension]`) automatically? *(Assumption: use `createLogger("pi-extension")` manually)*

---

## Success Metrics

- **Metric 1:** Running pi with the browser bridge extension loaded produces zero `[bridge]` lines in the TUI by default
- **Metric 2:** Setting `PI_BROWSER_BRIDGE_LOG_LEVEL=debug` restores all previous `console.*` output
- **Metric 3:** Zero `console.*` calls remain in `pi-extension/src/server.ts` and `index.ts`

---

## Risks & Mitigations

| Risk                                              | Impact | Likelihood | Mitigation                                    |
|---------------------------------------------------|--------|------------|-----------------------------------------------|
| Browser extension build breaks due to ESM import  | Medium | Low        | Vite handles workspace aliases; test build    |
| pi-extension env var not available in browser     | Low    | Low        | `chrome-extension` can default to `silent`    |
| Someone adds new `console.*` after migration      | Low    | Medium     | Add a biome/eslint rule or grep check in CI   |

---

## Appendix

### References
- [pi SDK docs — extensions](sdk.md) — no built-in logging API available

### Glossary
- **pi:** The `@mariozechner/pi-coding-agent` CLI / TUI
- **TUI:** Terminal User Interface — the interactive chat interface
