/**
 * WebSocket server for the pi-browser-bridge.
 *
 * Listens for connections from the Chrome extension, correlates requests to
 * responses by `id`, enforces per-request timeouts, and exposes a simple
 * `send()`/`onResponse()` API consumed by tool handlers.
 *
 * Built on Hono + @hono/node-server + ws (Node.js-native, no Bun dependency).
 *
 * @module server
 */

import { Hono } from "hono";
import { serve, upgradeWebSocket } from "@hono/node-server";
import { WebSocketServer, type WebSocket } from "ws";

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

const DEFAULT_PORT = 9242;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

// ── Hono app (routes registered once on first start) ───────────────────────

const app = new Hono();

// Root path: upgrade WebSocket or return friendly HTTP response.
// upgradeWebSocket only intercepts requests with Upgrade: websocket header;
// everything else falls through to the .get() handler below.
app.get(
  "/",
  upgradeWebSocket(() => ({
    onOpen(_event, ws) {
      wsConnections.add(ws.raw as WebSocket);
    },
    onMessage(event, _ws) {
      // Hono's upgradeWebSocket decodes non-binary messages as UTF-8 strings
      handleMessage(event.data as string);
    },
    onClose(_event, ws) {
      wsConnections.delete(ws.raw as WebSocket);
      if (wsConnections.size === 0) {
        rejectAllPending();
      }
    },
    onError(error, _ws) {
      console.error("[pi-bridge] WebSocket error:", error);
    },
  })),
);

// Fallback HTTP response for non-WebSocket requests
app.get("/", (c) =>
  c.text("Pi Browser Bridge — WebSocket server", 200),
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

function connectionResetError(requestId: string, attempt: number): ErrorResponse {
  return {
    code: "CONNECTION_RESET",
    message: `Connection reset while sending request ${requestId} (attempt ${attempt}/${MAX_RETRIES}).`,
    suggestion:
      "The WebSocket connection was lost. The browser extension may be reconnecting. Retrying...",
  };
}

// ── Core API ───────────────────────────────────────────────────────────────

/**
 * Send a {@link Request} to the connected browser extension and return a
 * promise that resolves with the matching {@link Response}.
 *
 * The promise rejects with a structured {@link ErrorResponse} if:
 * - No browser extension is connected (`BROWSER_NOT_CONNECTED`)
 * - The request times out after 30 s (`TIMEOUT`)
 * - The WebSocket send itself fails (`BROWSER_NOT_CONNECTED`)
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
  // Use the connected WS, or reject if none available.
  const ws = wsConnections.values().next().value;
  if (!ws) {
    // If this is the first attempt, wait briefly — the extension may be
    // in the middle of a reconnect cycle.
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

  // Guard: re-use the caller's id; if missing at runtime, generate one.
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

      // Retry on transient send failure (e.g. connection closing mid-send).
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

  // Basic structural validation
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

  // Every other message must carry an id to be routable
  if (typeof response.id !== "string" || response.id.length === 0) {
    console.error(
      "[pi-bridge] Received message without valid id:",
      data.slice(0, 200),
    );
    return;
  }

  // Resolve pending request if one is waiting for this id
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

// ── Connection lifecycle ───────────────────────────────────────────────────

function rejectAllPending(): void {
  const error = notConnectedError();
  for (const [id, pending] of pendingRequests) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  pendingRequests.clear();
}

// ── Start / Stop ───────────────────────────────────────────────────────────

/**
 * Start the WebSocket server.
 *
 * @param port — Override the default port (9242) or the `PI_BROWSER_PORT` env
 *               variable. If omitted, the env var is checked first, falling
 *               back to 9242. Pass `0` to let the OS assign a free port.
 * @returns A handle with the bound port number.
 */
export function start(port?: number): ServerHandle {
  const effectivePort =
    port ??
    Number.parseInt(
      process.env.PI_BROWSER_PORT ?? String(DEFAULT_PORT),
      10,
    );

  // Idempotent: stop any previous server before starting a new one
  if (wss !== null) {
    stop();
  }

  // Create a fresh WebSocketServer (noServer — Hono/Node http server
  // handles the upgrade event)
  wss = new WebSocketServer({ noServer: true });

  // Start the HTTP server with Hono as the request handler.
  // Node.js resolves the bound port synchronously after listen() returns,
  // so address() is available immediately.
  const httpServer = serve(
    {
      fetch: app.fetch,
      port: effectivePort,
      websocket: { server: wss },
    },
  );

  const addr = httpServer.address();
  const boundPort =
    typeof addr === "object" && addr !== null ? addr.port : effectivePort;

  // Create handle for lifecycle management
  serverHandle = {
    port: boundPort,
    _stop: () => {
      // Close all WebSocket connections cleanly
      for (const ws of wsConnections) {
        try {
          ws.close(1000, "Server shutting down");
        } catch {
          // Connection may already be closed — ignore
        }
      }
      wsConnections.clear();

      // Close the WebSocketServer
      if (wss) {
        wss.close();
        wss = null;
      }

      // Stop the HTTP server
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
  // Reject every pending request
  rejectAllPending();

  // Delegate actual server teardown to the handle
  if (serverHandle) {
    serverHandle._stop();
    serverHandle = null;
  }

  // Clear subscriber list
  responseHandlers.clear();
}
