/**
 * WebSocket server for the pi-browser-bridge.
 *
 * Listens for connections from the Chrome extension, correlates requests to
 * responses by `id`, enforces per-request timeouts, and exposes a simple
 * `send()`/`onResponse()` API consumed by tool handlers.
 *
 * When multiple pi instances are running, the first one becomes the **owner**
 * (binds the server). Subsequent instances connect to the owner as WebSocket
 * **clients** on the `/client` route. The owner relays requests and responses
 * between its Chrome extension connection and all pi clients.
 *
 * Built on Hono + @hono/node-server + ws (Node.js-native, no Bun dependency).
 *
 * @module server
 */

import { Hono } from "hono";
import { serve, upgradeWebSocket } from "@hono/node-server";
import { WebSocketServer, WebSocket as WSClient, type WebSocket } from "ws";

import type {
  Action,
  ErrorResponse,
  Request,
  Response,
} from "@pi-browser-bridge/protocol";

// ── Types ──────────────────────────────────────────────────────────────────

/** A pending request waiting for a matching response from the browser. */
interface PendingRequest {
  resolve: (response: Response) => void;
  reject: (error: ErrorResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Subscriber callback for unsolicited responses. */
type ResponseHandler = (response: Response) => void;

/** Handle returned by {@link start} for lifecycle management and port access. */
export interface ServerHandle {
  port: number;
  /** @internal Stop the server (prefer the public {@link stop} function). */
  _stop: () => void;
}

// ── Shared state ───────────────────────────────────────────────────────────

let wss: WebSocketServer | null = null;
let serverHandle: ServerHandle | null = null;
let wsConnections = new Set<WebSocket>();
let pendingRequests = new Map<string, PendingRequest>();
let responseHandlers = new Set<ResponseHandler>();

/** Set when this instance is a client connected to an owner server. */
let clientSocket: WSClient | null = null;

/** True during intentional shutdown — suppresses reconnect attempts. */
let shuttingDown = false;

/** Port used for reconnection attempts (set on first start). */
let reconnectPort = 9242;

/** Timer for debounced reconnect scheduling. */
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/** Sequence number assigned by the owner (set in client mode). */
let clientSequenceNumber = -1;

// ── Owner-only state ───────────────────────────────────────────────────────

/** Maps request id → pi client WebSocket (owner mode relay). */
const clientToRequest = new Map<string, WebSocket>();

/** Timeouts for proxied client requests (owner mode). */
const requestTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Next sequence number to assign to a connecting pi client. */
let nextClientSequence = 0;

/** Maps pi client WebSocket → assigned sequence number. */
const clientSequences = new Map<WebSocket, number>();

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_PORT = 9242;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

// ── Hono app (routes registered once on first start) ───────────────────────

const app = new Hono();

// / — Chrome extension connection (owner receives)
app.get(
  "/",
  upgradeWebSocket(() => ({
    onOpen(_event, ws) {
      wsConnections.add(ws.raw as WebSocket);
      console.log("[pi-bridge] Chrome extension connected");
    },
    onMessage(event, _ws) {
      handleMessage(event.data as string);
    },
    onClose(_event, ws) {
      wsConnections.delete(ws.raw as WebSocket);
      console.log("[pi-bridge] Chrome extension disconnected");
      if (wsConnections.size === 0) {
        rejectAllPending();
      }
    },
    onError(error, _ws) {
      console.error("[pi-bridge] WebSocket error:", error);
    },
  })),
);

// /client — pi client connections (owner receives)
app.get(
  "/client",
  upgradeWebSocket(() => ({
    onOpen(_event, ws) {
      const raw = ws.raw as WebSocket;
      const seq = nextClientSequence++;
      clientSequences.set(raw, seq);

      // Send welcome with sequence number so the client knows its failover priority
      try {
        raw.send(JSON.stringify({ type: "welcome", sequence: seq }));
      } catch {
        // Client may have closed before we could send — ignore
      }

      console.log(`[pi-bridge] Pi client connected (sequence ${seq})`);
    },
    onMessage(event, ws) {
      handleClientMessage(event.data as string, ws.raw as WebSocket);
    },
    onClose(_event, ws) {
      const raw = ws.raw as WebSocket;
      const seq = clientSequences.get(raw);
      clientSequences.delete(raw);
      console.log(`[pi-bridge] Pi client disconnected (sequence ${seq ?? "?"})`);
      cleanupClientRequests(raw);
    },
    onError(error, _ws) {
      console.error("[pi-bridge] Client WebSocket error:", error);
    },
  })),
);

// Fallback HTTP response for non-WebSocket requests on both routes
app.get("/", (c) =>
  c.text("Pi Browser Bridge — WebSocket server", 200),
);
app.get("/client", (c) =>
  c.text("Pi Browser Bridge — client endpoint", 200),
);

// ── Error factories ────────────────────────────────────────────────────────

function timeoutError(requestId: string): ErrorResponse {
  return {
    code: "TIMEOUT",
    message: `Request ${requestId} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`,
    suggestion:
      "The browser may be unresponsive. Check the browser console for errors.",
  };
}

function notConnectedError(): ErrorResponse {
  return {
    code: "BROWSER_NOT_CONNECTED",
    message:
      "No browser extension is connected to the WebSocket server.",
    suggestion:
      "Make sure the Pi Browser Bridge Chrome extension is installed and running.",
  };
}

function sendFailedError(): ErrorResponse {
  return {
    code: "BROWSER_NOT_CONNECTED",
    message: "Failed to send message to the browser extension.",
    suggestion:
      "The WebSocket connection may have been closed. Try restarting the extension.",
  };
}

function ownerNotConnectedError(): ErrorResponse {
  return {
    code: "BROWSER_NOT_CONNECTED",
    message:
      "Lost connection to the owner pi instance that runs the browser bridge server.",
    suggestion:
      "The first pi instance may have shut down. Restart pi instances in order.",
  };
}

function ownerUnreachableError(): ErrorResponse {
  return {
    code: "BROWSER_NOT_CONNECTED",
    message:
      "Could not reach the browser bridge server.",
    suggestion:
      "Make sure at least one pi instance is running with the browser bridge extension loaded.",
  };
}

// ── Core API ───────────────────────────────────────────────────────────────

/**
 * Send a {@link Request} to the connected browser extension and return a
 * promise that resolves with the matching {@link Response}.
 *
 * In owner mode, sends directly over the Chrome extension WebSocket.
 * In client mode, sends over the client WebSocket to the owner server,
 * which relays to the Chrome extension and back.
 *
 * The promise rejects with a structured {@link ErrorResponse} if:
 * - No browser extension is connected (`BROWSER_NOT_CONNECTED`)
 * - The owner server is unreachable (client mode, `BROWSER_NOT_CONNECTED`)
 * - The request times out after 30 s (`TIMEOUT`)
 *
 * @typeParam A — Concrete action. Defaults to the full {@link Action} union.
 */
export function send<A extends Action = Action>(
  request: Request<A>,
): Promise<Response<A>> {
  return sendWithRetry<A>(request, 1) as Promise<Response<A>>;
}

/**
 * Internal: attempt to send a request, retrying on transient connection
 * failures up to {@link MAX_RETRIES} times.
 */
function sendWithRetry<A extends Action = Action>(
  request: Request<A>,
  attempt: number,
): Promise<Response<A> | ErrorResponse> {
  // Client mode: use the client socket to the owner server
  if (clientSocket) {
    return sendViaClient<A>(request, attempt);
  }

  // Owner mode: use the Chrome extension connection
  const ws = wsConnections.values().next().value;
  if (!ws) {
    if (attempt <= MAX_RETRIES) {
      return waitForConnection(RETRY_DELAY_MS * attempt).then((reconnected) => {
        if (reconnected) {
          return sendWithRetry<A>(request, attempt + 1);
        }
        return Promise.reject(notConnectedError());
      });
    }
    return Promise.reject(notConnectedError());
  }

  const id = request.id ?? crypto.randomUUID();
  const outgoing = { ...request, id };

  return new Promise<Response<A>>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(timeoutError(id));
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(id, {
      resolve: resolve as (r: Response) => void,
      reject,
      timer,
    });

    try {
      ws.send(JSON.stringify(outgoing));
    } catch {
      clearTimeout(timer);
      pendingRequests.delete(id);

      if (attempt <= MAX_RETRIES) {
        console.warn(
          `[pi-bridge] Send failed for request ${id}, retrying (${attempt}/${MAX_RETRIES})...`,
        );
        setTimeout(() => {
          sendWithRetry<A>(request, attempt + 1)
            .then((r) => resolve(r as Response<A>))
            .catch(reject);
        }, RETRY_DELAY_MS * attempt);
      } else {
        reject(sendFailedError());
      }
    }
  }) as Promise<Response<A>>;
}

/**
 * Send a request over the client WebSocket to the owner server.
 */
function sendViaClient<A extends Action = Action>(
  request: Request<A>,
  attempt: number,
): Promise<Response<A> | ErrorResponse> {
  if (!clientSocket || clientSocket.readyState !== WSClient.OPEN) {
    return Promise.reject(ownerNotConnectedError());
  }

  const id = request.id ?? crypto.randomUUID();
  const outgoing = { ...request, id };

  return new Promise<Response<A>>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(timeoutError(id));
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(id, {
      resolve: resolve as (r: Response) => void,
      reject,
      timer,
    });

    try {
      clientSocket!.send(JSON.stringify(outgoing));
    } catch {
      clearTimeout(timer);
      pendingRequests.delete(id);

      if (attempt <= MAX_RETRIES) {
        console.warn(
          `[pi-bridge] Client send failed for request ${id}, retrying (${attempt}/${MAX_RETRIES})...`,
        );
        setTimeout(() => {
          sendViaClient<A>(request, attempt + 1)
            .then((r) => resolve(r as Response<A>))
            .catch(reject);
        }, RETRY_DELAY_MS * attempt);
      } else {
        reject(ownerNotConnectedError());
      }
    }
  }) as Promise<Response<A>>;
}

/**
 * Wait up to `timeoutMs` for a new WebSocket connection to appear.
 * Returns `true` if a connection was established within the timeout.
 */
function waitForConnection(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;

    function check() {
      if (wsConnections.size > 0) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(check, 100);
    }

    check();
  });
}

/**
 * Subscribe to all incoming responses, including unsolicited events that do
 * not correspond to a pending request.
 *
 * Returns an unsubscribe function.
 */
export function onResponse(handler: ResponseHandler): () => void {
  responseHandlers.add(handler);
  return () => {
    responseHandlers.delete(handler);
  };
}

// ── Message handling ───────────────────────────────────────────────────────

/**
 * Handle a message from the Chrome extension (owner mode).
 * Resolves pending local requests and relays proxied responses to pi clients.
 */
function handleMessage(data: string): void {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    console.error(
      "[pi-bridge] Failed to parse incoming JSON:",
      data.slice(0, 200),
    );
    return;
  }

  if (typeof message !== "object" || message === null) {
    console.error(
      "[pi-bridge] Received non-object message:",
      typeof message,
    );
    return;
  }

  const response = message as Record<string, unknown>;

  // Protocol-level keepalive — silently ignore
  if (response.type === "ping") return;

  if (typeof response.id !== "string" || response.id.length === 0) {
    console.error(
      "[pi-bridge] Received message without valid id:",
      data.slice(0, 200),
    );
    return;
  }

  // ── Relay to pi client if this response belongs to a proxied request ──
  const clientWs = clientToRequest.get(response.id);
  if (clientWs) {
    clientToRequest.delete(response.id);
    const timer = requestTimers.get(response.id);
    if (timer) {
      clearTimeout(timer);
      requestTimers.delete(response.id);
    }
    try {
      clientWs.send(data);
    } catch {
      // Client disconnected — ignore
    }
    return;
  }

  // ── Resolve local pending request ──
  const pending = pendingRequests.get(response.id);
  if (pending) {
    clearTimeout(pending.timer);
    pendingRequests.delete(response.id);
    pending.resolve(message as Response);
  }

  // Notify all subscribers (fires for both correlated and unsolicited messages)
  for (const handler of responseHandlers) {
    try {
      handler(message as Response);
    } catch (err) {
      console.error("[pi-bridge] Error in response handler:", err);
    }
  }
}

/**
 * Handle a message from a pi client (owner mode).
 * Forwards the request to the Chrome extension and records the mapping
 * so the response can be relayed back.
 */
function handleClientMessage(data: string, clientWs: WebSocket): void {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    console.error(
      "[pi-bridge] Failed to parse client JSON:",
      data.slice(0, 200),
    );
    return;
  }

  if (typeof message !== "object" || message === null) return;

  const request = message as Record<string, unknown>;

  // Keepalive — silently ignore
  if (request.type === "ping") return;

  if (typeof request.id !== "string" || request.id.length === 0) {
    console.error(
      "[pi-bridge] Client sent message without valid id:",
      data.slice(0, 200),
    );
    return;
  }

  const requestId: string = request.id;

  // Forward to Chrome extension
  const browserWs = wsConnections.values().next().value;
  if (!browserWs) {
    clientWs.send(JSON.stringify({
      id: requestId,
      error: notConnectedError(),
    }));
    return;
  }

  // Record mapping for relay
  clientToRequest.set(requestId, clientWs);

  // Timeout: if the browser never responds, clean up and send error to client
  const timer = setTimeout(() => {
    clientToRequest.delete(requestId);
    requestTimers.delete(requestId);
    try {
      clientWs.send(JSON.stringify({
        id: requestId,
        error: timeoutError(requestId),
      }));
    } catch {
      // Client already gone
    }
  }, REQUEST_TIMEOUT_MS);
  requestTimers.set(requestId, timer);

  try {
    browserWs.send(data);
  } catch {
    clearTimeout(timer);
    clientToRequest.delete(requestId);
    requestTimers.delete(requestId);
    try {
      clientWs.send(JSON.stringify({
        id: requestId,
        error: sendFailedError(),
      }));
    } catch {
      // Client already gone
    }
  }
}

/**
 * Clean up all proxied requests for a disconnected pi client.
 */
function cleanupClientRequests(clientWs: WebSocket): void {
  for (const [id, ws] of clientToRequest) {
    if (ws === clientWs) {
      clientToRequest.delete(id);
      const timer = requestTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        requestTimers.delete(id);
      }
    }
  }
}

// ── Connection lifecycle ───────────────────────────────────────────────────

function rejectAllPending(): void {
  const error = notConnectedError();
  for (const [id, pending] of pendingRequests) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  pendingRequests.clear();

  // Also reject any client-proxied requests that are still waiting
  for (const [id, timer] of requestTimers) {
    clearTimeout(timer);
  }
  requestTimers.clear();
  clientToRequest.clear();
  clientSequences.clear();
  nextClientSequence = 0;
}

// ── Start / Stop ───────────────────────────────────────────────────────────

/**
 * Schedule a reconnection attempt after losing the owner connection.
 *
 * Clients try to become owner in sequence order (lowest sequence first).
 * Each client waits `sequence * 300ms` so they don't race:
 *   - client sequence 0 → immediate
 *   - client sequence 1 → 300ms
 *   - client sequence 2 → 600ms
 *   - ...
 *
 * If an earlier client becomes the new owner, later clients detect it
 * via `tryConnectAsClient` and reconnect as clients instead.
 */
function scheduleReconnect(port: number): void {
  if (shuttingDown) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);

  // Deterministic delay based on connection order
  const delay = Math.max(0, clientSequenceNumber) * 300;

  console.log(
    `[pi-bridge] Failover scheduled in ${delay}ms ` +
      `(sequence ${clientSequenceNumber})`,
  );

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (shuttingDown) return;

    console.log("[pi-bridge] Attempting to take over as owner...");

    // Try client mode first — maybe an earlier client already became owner
    const handle = await tryConnectAsClient(port);
    if (handle) {
      console.log("[pi-bridge] Another client became owner — reconnected as client");
      return;
    }

    // No server running — become the owner
    console.log("[pi-bridge] No owner found, taking over as owner...");
    startAsOwner(port);
  }, delay);
}

/**
 * Start the WebSocket server.
 *
 * Tries to connect as a client to an already-running owner server first.
 * If no owner is available, starts a new server and becomes the owner.
 *
 * On owner disconnect, surviving clients automatically reconnect or
 * promote to owner (failover).
 *
 * @param port — Override the default port (9242) or the `PI_BROWSER_PORT` env
 *               variable. If omitted, the env var is checked first, falling
 *               back to 9242. Pass `0` to let the OS assign a free port
 *               (owner mode only — client mode uses the given port).
 * @returns A handle with the bound port number.
 */
export async function start(port?: number): Promise<ServerHandle> {
  const effectivePort =
    port ??
    Number.parseInt(
      process.env.PI_BROWSER_PORT ?? String(DEFAULT_PORT),
      10,
    );

  reconnectPort = effectivePort;
  shuttingDown = false;

  // Idempotent: stop any previous server before starting a new one
  if (wss !== null || clientSocket !== null) {
    stop();
  }

  // ── Try client mode first: connect to an existing owner server ──
  const clientHandle = await tryConnectAsClient(effectivePort);
  if (clientHandle) {
    return clientHandle;
  }

  // ── No server running — become the owner ──
  return startAsOwner(effectivePort);
}

/**
 * Try to connect to an existing owner server as a client.
 * Returns a handle if successful, `null` if no server is available.
 */
function tryConnectAsClient(port: number): Promise<ServerHandle | null> {
  return new Promise((resolve) => {
    const url = `ws://localhost:${port}/client`;
    const ws = new WSClient(url);

    const timeout = setTimeout(() => {
      ws.close();
      resolve(null);
    }, 1500);

    ws.on("open", () => {
      clearTimeout(timeout);
      clientSocket = ws;

      // Reset sequence — the owner will assign a new one via welcome message
      clientSequenceNumber = -1;

      let welcomed = false;

      ws.on("message", (data) => {
        const raw = data.toString();

        // Intercept welcome message from owner (assigns failover priority)
        if (!welcomed) {
          try {
            const msg = JSON.parse(raw);
            if (msg.type === "welcome" && typeof msg.sequence === "number") {
              clientSequenceNumber = msg.sequence;
              welcomed = true;
              console.log(
                `[pi-bridge] Connected as client to owner server on port ${port} ` +
                  `(sequence ${clientSequenceNumber})`,
              );
              return;
            }
          } catch {
            // Not JSON or not a welcome message — fall through
          }
        }

        // Responses from the owner server come back here.
        // Reuse the same handleMessage logic — it resolves pending requests.
        handleMessage(raw);
      });

      ws.on("close", () => {
        clientSocket = null;
        if (shuttingDown) {
          console.log("[pi-bridge] Client disconnected (shutting down)");
          return;
        }
        console.warn("[pi-bridge] Lost connection to owner server — will attempt failover");
        rejectAllPending();
        scheduleReconnect(port);
      });

      ws.on("error", (err) => {
        console.error("[pi-bridge] Client socket error:", err.message);
      });

      resolve({
        port,
        _stop: () => {
          clearTimeout(timeout);
          if (clientSocket) {
            clientSocket.close();
            clientSocket = null;
          }
        },
      });
    });

    ws.on("error", () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

/**
 * Start the HTTP + WebSocket server and become the owner.
 */
function startAsOwner(effectivePort: number): ServerHandle {
  wss = new WebSocketServer({ noServer: true });

  const httpServer = serve(
    {
      fetch: app.fetch,
      port: effectivePort,
      websocket: { server: wss },
    },
  );

  // Handle port-already-in-use — another instance may have taken over
  // between our client-mode check and this bind attempt.
  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.warn(
        `[pi-bridge] Port ${effectivePort} is already in use — ` +
          `another instance likely took over. Retrying as client...`,
      );
    } else {
      console.error(
        `[pi-bridge] Server error on port ${effectivePort}:`,
        err.message,
      );
    }
    // Tear down failed owner state
    if (wss) {
      wss.close();
      wss = null;
    }
    serverHandle = null;
    rejectAllPending();
    responseHandlers.clear();

    // If it was EADDRINUSE, retry as client instead of giving up
    if (err.code === "EADDRINUSE" && !shuttingDown) {
      scheduleReconnect(effectivePort);
    }
  });

  const addr = httpServer.address();
  const boundPort =
    typeof addr === "object" && addr !== null ? addr.port : effectivePort;

  console.log(`[pi-bridge] Owner server listening on port ${boundPort}`);

  serverHandle = {
    port: boundPort,
    _stop: () => {
      for (const ws of wsConnections) {
        try { ws.close(1000, "Server shutting down"); } catch { /* ok */ }
      }
      wsConnections.clear();

      // Close client-proxied request timers
      for (const timer of requestTimers.values()) {
        clearTimeout(timer);
      }
      requestTimers.clear();
      clientToRequest.clear();
      clientSequences.clear();
      nextClientSequence = 0;

      if (wss) {
        wss.close();
        wss = null;
      }

      httpServer.close();
    },
  };

  return serverHandle;
}

/**
 * Gracefully shut down the WebSocket server.
 *
 * All active connections are closed, pending requests are rejected with
 * `BROWSER_NOT_CONNECTED`, and response subscribers are cleared.
 */
export function stop(): void {
  shuttingDown = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  rejectAllPending();

  if (clientSocket) {
    try { clientSocket.close(); } catch { /* ok */ }
    clientSocket = null;
  }

  clientSequenceNumber = -1;

  if (serverHandle) {
    serverHandle._stop();
    serverHandle = null;
  }

  responseHandlers.clear();
}
