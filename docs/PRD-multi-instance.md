# PRD: Multi-Instance Browser Bridge

**Status:** Approved (implemented)
**Created:** 2026-05-02
**Author:** AI Agent (from discussion with marco-souza)
**Version:** 1.0

---

## Executive Summary

Enable multiple pi coding agent instances to share a single Chrome extension
connection through a client-mode relay architecture with automatic owner
failover. When the first instance quits, surviving instances elect a new
owner without user intervention.

---

## Problem Statement

The pi-browser-bridge runs a WebSocket server that the Chrome extension
connects to. Each pi instance loads the extension independently and tries
to bind port 9242. The first instance succeeds; subsequent instances crash
with `EADDRINUSE`. Even after the crash was fixed (graceful warning),
subsequent instances had no browser access because only one WebSocket
connection existed.

Today's workaround: users manually ensure only one pi instance is running.
This breaks the multi-pane tmux workflow common among pi users.

---

## Goals

- **Multiple pi instances** share one browser bridge without crashing
- **Transparent tool calls** from any instance — same `send()` API works
  whether you're the owner or a client
- **Automatic failover** — if the owner quits, another instance takes over
  within 1–2 seconds
- **No Chrome extension changes** — extension still connects to a single server
- **Graceful degradation** — pending requests from clients are rejected on
  disconnect so the LLM can retry after failover

---

## Non-Goals

- ❌ Chrome extension connecting to multiple servers (multi-connection extension)
- ❌ Inter-process communication via Unix sockets or shared memory
- ❌ Persistent reconnection with exponential backoff (simple one-shot retry)
- ❌ Request queuing during failover (requests fail and LLM retries)
- ❌ Cross-machine relay (localhost only)

---

## User Stories

### Must Have (P0)

- As a pi user, I want to open multiple terminal panes with pi running so
  that I can work on different tasks in parallel without losing browser access.
- As a pi user, I want any pi instance to execute browser tools (navigate,
  click, type, etc.) so that I don't need to remember which pane is the
  "browser one."
- As a pi user, I want the browser bridge to keep working when I close the
  first pi instance so that I don't have to restart my workflow.

### Nice to Have (P2)

- As a pi user, I want to see in the logs which role my instance has
  (owner vs. client) so that I can debug connection issues.

---

## Functional Requirements

### FR-1: Client-Mode Connection

- On `start()`, system must first attempt a WebSocket connection to
  `ws://localhost:{port}/client`.
- If the connection succeeds, system enters **client mode**: `send()` routes
  over this socket to the owner, which relays to the Chrome extension.
- If the connection fails (no server listening), system becomes the **owner**
  and binds the HTTP + WebSocket server on `{port}`.
- System must distinguish two WebSocket routes:
  - `/` — Chrome extension connection (owner receives)
  - `/client` — pi client connections (owner receives, relays to `/`)

### FR-2: Request Relay (Owner)

- When a pi client sends a request, the owner must:
  1. Record `clientToRequest[requestId] = clientWebSocket`
  2. Forward the raw JSON to the Chrome extension via `/`
  3. Set a timeout (30s) for the proxied request
- When the Chrome extension responds:
  1. If `response.id` is in `clientToRequest`, relay the raw JSON to that
     pi client and clean up the mapping.
  2. Otherwise, resolve the owner's own local pending request.
- When a pi client disconnects, clean up all its proxied request mappings.

### FR-3: Transparent `send()` API

- `send()` must route through the correct WebSocket:
  - Client mode: `clientSocket` → owner `/client`
  - Owner mode: `wsConnections` → Chrome extension `/`
- `onResponse()` subscriptions must fire for both local and relayed responses.
- Error codes must be appropriate:
  - Client can't reach owner → `BROWSER_NOT_CONNECTED` with "Lost connection
    to the owner pi instance"
  - Chrome extension disconnected → `BROWSER_NOT_CONNECTED` with standard
    "No browser extension" message

### FR-4: Sequential Failover by Connection Order

- Owner assigns each connecting client a monotonic sequence number (`0`, `1`,
  `2`, ...) via a `{"type":"welcome","sequence":N}` message on connect.
- When a client's WebSocket to the owner closes (not during intentional
  shutdown):
  1. Reject all pending requests immediately.
  2. Wait `sequence × 300ms` before attempting failover:
     - Client with sequence `0` → immediate (0ms)
     - Client with sequence `1` → 300ms
     - Client with sequence `2` → 600ms
  3. Try `ws://localhost:{port}/client` — if available (an earlier client
     became owner), reconnect as client.
  4. If not available, call `startAsOwner(port)` to become the new owner.
- If `startAsOwner` hits `EADDRINUSE` (earlier client bound the port just
  before us), retry step 3 (connect as client to the new owner).
- System must suppress failover during intentional `stop()` via a
  `shuttingDown` flag.

### FR-5: Shutdown

- `stop()` must:
  1. Set `shuttingDown = true` to suppress reconnect
  2. Cancel any pending reconnect timer
  3. Reject all pending requests
  4. Close client socket (if any)
  5. Stop HTTP server (if owner)
  6. Clear response subscribers

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Chrome Extension                                             │
│   Connects to ws://localhost:9242/                           │
└─────────────┬───────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│ Owner Pi Instance (first to start)                           │
│   /           ← Chrome extension WS                          │
│   /client     ← Pi client WS (relay)                         │
│                                                              │
│   clientToRequest: Map<requestId, clientWs>                  │
│   handleMessage(): resolve local OR relay to client          │
│   handleClientMessage(): forward to Chrome ext + record map │
└──────┬──────────────────────────────────┬───────────────────┘
       │                                  │
       ▼                                  ▼
┌──────────────┐                   ┌──────────────┐
│ Pi Instance 2 │                  │ Pi Instance 3 │
│ (client mode) │                  │ (client mode) │
│               │                  │               │
│ clientSocket ─┼──────────────────┼─ clientSocket │
│ send() routes │                  │ send() routes │
│ via clientWs  │                  │ via clientWs  │
└──────────────┘                   └──────────────┘
```

**Failover sequence (sequential by connection order):**

```
Owner assigns: client A → sequence 0, client B → sequence 1, client C → 2

Owner quits
  → all client sockets close
  → client A (seq 0): immediate → tryConnectAsClient → no one there
    → startAsOwner(9242) succeeds → "Owner server listening on port 9242"
  → client B (seq 1): after 300ms → tryConnectAsClient succeeds
    → "Reconnected as client to new owner" (A is the new owner)
  → client C (seq 2): after 600ms → tryConnectAsClient succeeds
    → "Reconnected as client to new owner"

If client A is also dead:
  → A doesn't respond (its process quit too)
  → B (seq 1): after 300ms → tryConnectAsClient → no one there
    → startAsOwner(9242) succeeds → B becomes owner
  → C (seq 2): after 600ms → tryConnectAsClient → connects to B
```

---

## Non-Functional Requirements

| Category    | Requirement                     | Target                |
|-------------|---------------------------------|-----------------------|
| Performance | Relay overhead per request      | < 5ms (local WS hop)  |
| Reliability | Failover time                   | < 2s (300-1500ms wait)|
| Reliability | No crashes on EADDRINUSE        | 100%                  |
| Scalability | Concurrent pi client instances  | Tested with 3, no hard limit |

---

## Dependencies

- **Internal:** `server.ts` (WebSocket server), `pi-extension/src/index.ts` (lifecycle)
- **External:** `ws` (WebSocket client/server), `@hono/node-server`
- **Unchanged:** Chrome extension (connects to single `/` endpoint)

---

## Open Questions

- [ ] Should pending requests be queued during failover instead of rejected?
  (Currently: rejected immediately, LLM retries. Acceptable for v1.)
- [ ] Should the Chrome extension try `/client` as a fallback if `/` is
  unreachable? (No — the extension always connects to the owner's `/`.)
- [ ] Exponential backoff for repeated reconnect failures? (Not needed —
  one-shot is sufficient since at least one instance is always running.)

---

## Risks & Mitigations

| Risk                                      | Impact | Likelihood | Mitigation                                  |
|-------------------------------------------|--------|------------|---------------------------------------------|
| Two instances race to `startAsOwner`       | Low    | Medium     | EADDRINUSE → retry as client                |
| Network partition (rare on localhost)       | Low    | Low        | Client times out in 30s, LLM retries        |
| Chrome extension disconnects while clients active | Medium | Low    | Pending requests time out (30s)             |
| Reconnect timer fires after intentional stop | Medium | Low     | `shuttingDown` flag checked before each step |
