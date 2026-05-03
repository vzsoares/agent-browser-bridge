/**
 * Hono WebSocket server — lifecycle management, routing, and failover
 * orchestration.
 *
 * Sets up the Hono app with two WebSocket routes:
 * - `/` — Chrome extension connection (owner receives).
 * - `/client` — pi client connections (owner receives from other pi
 *   instances in client mode).
 *
 * Implements the {@link ServerLifecycle} port from the domain layer:
 * `start()` tries client mode first, falls back to owner mode.
 * `stop()` gracefully tears everything down.
 *
 * This module is the top-level orchestrator in the infrastructure layer.
 * It imports from `ws-transport.ts` (core send/onResponse/handleMessage)
 * and `ws-failover.ts` (client-mode state), plus the domain ports and
 * I/O libraries (Hono, ws).
 *
 * @module infrastructure/ws-server
 */

import { Hono } from "hono";
import { serve, upgradeWebSocket } from "@hono/node-server";
import {
  WebSocketServer,
  type WebSocket,
} from "ws";
import { createLogger } from "@pi-browser-bridge/logger";

import type { ServerHandle } from "../domain/ports.js";

// ── Internal types ─────────────────────────────────────────────────────────

/** Internal handle with a `_stop` method for lifecycle management. */
interface InternalServerHandle extends ServerHandle {
  /** @internal Stop the server (prefer the public {@link stop} function). */
  _stop: () => void;
}

import {
  addWsConnection,
  removeWsConnection,
  getWsConnectionCount,
  getAnyConnection,
  closeAllWsConnections,
  rejectAllPending,
  clearResponseHandlers,
  clearRelayState,
  handleMessage,
  handleClientMessage,
  cleanupClientRequests,
  assignClientSequence,
  removeClientSequence,
  send,
  onResponse,
} from "./ws-transport.js";

import {
  getClientSocket,
  setClientSocket,
  getClientSequenceNumber,
  setClientSequenceNumber,
  isShuttingDown,
  setShuttingDown,
  setReconnectPort,
  tryConnectAsClient,
  closeClientSocket,
} from "./ws-failover.js";

const logger = createLogger("pi-bridge:server");

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_PORT = 9242;

// ── Server instance state ──────────────────────────────────────────────────

let wss: WebSocketServer | null = null;
let serverHandle: InternalServerHandle | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// ── Hono app (routes registered once) ──────────────────────────────────────

const app = new Hono();

// / — Chrome extension connection (owner receives)
app.get(
  "/",
  upgradeWebSocket(() => ({
    onOpen(_event, ws) {
      const raw = ws.raw as WebSocket;
      addWsConnection(raw);
      logger.info("Chrome extension connected");
    },
    onMessage(event, _ws) {
      handleMessage(event.data as string);
    },
    onClose(_event, ws) {
      const raw = ws.raw as WebSocket;
      removeWsConnection(raw);
      logger.info("Chrome extension disconnected");
      if (getWsConnectionCount() === 0) {
        rejectAllPending();
      }
    },
    onError(error, _ws) {
      logger.error("WebSocket error:", error);
    },
  })),
);

// /client — pi client connections (owner receives)
app.get(
  "/client",
  upgradeWebSocket(() => ({
    onOpen(_event, ws) {
      const raw = ws.raw as WebSocket;
      const seq = assignClientSequence(raw);

      // Send welcome with sequence number so the client knows its
      // failover priority.
      try {
        raw.send(JSON.stringify({ type: "welcome", sequence: seq }));
      } catch {
        // Client may have closed before we could send — ignore
      }

      logger.info(`Pi client connected (sequence ${seq})`);
    },
    onMessage(event, ws) {
      const raw = ws.raw as WebSocket;
      handleClientMessage(event.data as string, raw, getAnyConnection);
    },
    onClose(_event, ws) {
      const raw = ws.raw as WebSocket;
      const seq = removeClientSequence(raw);
      logger.info(`Pi client disconnected (sequence ${seq ?? "?"})`);
      cleanupClientRequests(raw);
    },
    onError(error, _ws) {
      logger.error("Client WebSocket error:", error);
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

// ── Schedule reconnection (failover orchestration) ─────────────────────────

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
  if (isShuttingDown()) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);

  const seq = getClientSequenceNumber();
  const delay = Math.max(0, seq) * 300;

  logger.info(
    `Failover scheduled in ${delay}ms ` + `(sequence ${seq})`,
  );

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (isShuttingDown()) return;

    logger.info("Attempting to take over as owner...");

    // Try client mode first — maybe an earlier client already became owner
    const result = await tryConnectAsClient(port, handleMessage);
    if (result) {
      setClientSocket(result.ws);

      // Attach close handler for failover
      result.ws.on("close", () => {
        setClientSocket(null);
        if (!isShuttingDown()) {
          logger.warn(
            "Lost connection to owner server — will attempt failover",
          );
          rejectAllPending();
          scheduleReconnect(port);
        } else {
          logger.info("Client disconnected (shutting down)");
        }
      });

      logger.info("Another client became owner — reconnected as client");
      return;
    }

    // No server running — become the owner
    logger.info("No owner found, taking over as owner...");
    startAsOwner(port);
  }, delay);
}

// ── Start as owner ─────────────────────────────────────────────────────────

/**
 * Start the HTTP + WebSocket server and become the owner.
 * Returns a handle with the bound port and a `_stop` function.
 */
function startAsOwner(effectivePort: number): InternalServerHandle {
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
      logger.warn(
        `Port ${effectivePort} is already in use — ` +
          `another instance likely took over. Retrying as client...`,
      );
    } else {
      logger.error(
        `Server error on port ${effectivePort}:`,
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
    clearResponseHandlers();

    // If it was EADDRINUSE, retry as client instead of giving up
    if (err.code === "EADDRINUSE" && !isShuttingDown()) {
      scheduleReconnect(effectivePort);
    }
  });

  const addr = httpServer.address();
  const boundPort =
    typeof addr === "object" && addr !== null ? addr.port : effectivePort;

  logger.info(`Owner server listening on port ${boundPort}`);

  serverHandle = {
    port: boundPort,
    _stop: () => {
      closeAllWsConnections();
      clearRelayState();
      if (wss) {
        wss.close();
        wss = null;
      }
      httpServer.close();
    },
  };

  return serverHandle;
}

// ── Public API: start ──────────────────────────────────────────────────────

/**
 * Start the WebSocket server.
 *
 * Tries to connect as a client to an already-running owner server first.
 * If no owner is available, starts a new server and becomes the owner.
 *
 * On owner disconnect, surviving clients automatically reconnect or
 * promote to owner (failover).
 *
 * @param port — Override the default port (9242) or the `PI_BROWSER_PORT`
 *               env variable. If omitted, the env var is checked first,
 *               falling back to 9242. Pass `0` to let the OS assign a free
 *               port (owner mode only — client mode uses the given port).
 * @returns A handle with the bound port number.
 */
export async function start(port?: number): Promise<InternalServerHandle> {
  const effectivePort =
    port ??
    Number.parseInt(
      process.env.PI_BROWSER_PORT ?? String(DEFAULT_PORT),
      10,
    );

  setReconnectPort(effectivePort);
  setShuttingDown(false);

  // Idempotent: stop any previous server before starting a new one
  if (wss !== null || getClientSocket() !== null) {
    stop();
  }

  // ── Try client mode first: connect to an existing owner server ──
  const result = await tryConnectAsClient(effectivePort, handleMessage);
  if (result) {
    setClientSocket(result.ws);

    // Attach close handler for failover
    result.ws.on("close", () => {
      setClientSocket(null);
      if (isShuttingDown()) {
        logger.info("Client disconnected (shutting down)");
        return;
      }
      logger.warn(
        "Lost connection to owner server — will attempt failover",
      );
      rejectAllPending();
      scheduleReconnect(effectivePort);
    });

    return {
      port: result.port,
      _stop: () => {
        if (getClientSocket()) {
          closeClientSocket();
          setClientSocket(null);
        }
      },
    };
  }

  // ── No server running — become the owner ──
  return startAsOwner(effectivePort);
}

// ── Public API: stop ───────────────────────────────────────────────────────

/**
 * Gracefully shut down the WebSocket server.
 *
 * All active connections are closed, pending requests are rejected with
 * `BROWSER_NOT_CONNECTED`, and response subscribers are cleared.
 */
export function stop(): void {
  setShuttingDown(true);

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  rejectAllPending();

  closeClientSocket();
  setClientSocket(null);
  setClientSequenceNumber(-1);

  if (serverHandle) {
    serverHandle._stop();
    serverHandle = null;
  }

  clearResponseHandlers();
}

// ── Re-exports for convenience ─────────────────────────────────────────────

export { send, onResponse };
export type { ServerHandle };
