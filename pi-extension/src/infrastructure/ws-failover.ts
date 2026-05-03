/**
 * WebSocket failover — owner/client promotion and reconnection.
 *
 * Holds the module-level state for client mode (when this pi instance
 * is connected to a remote owner server instead of hosting the server
 * itself).  Also provides `tryConnectAsClient` which creates the
 * client WebSocket and negotiates the welcome handshake.
 *
 * This module does **not** import from `ws-transport.ts` or
 * `ws-server.ts`.  It depends only on domain types, the shared
 * protocol, the logger, and the `ws` library.
 *
 * @module infrastructure/ws-failover
 */

import { WebSocket as WSClient } from "ws";

import { createLogger } from "@pi-browser-bridge/logger";

const logger = createLogger("pi-bridge:failover");

// ── Client-mode state ──────────────────────────────────────────────────────

/** Active client connection to an owner server (null when this is the owner). */
let clientSocket: WSClient | null = null;

/** Sequence number assigned by the owner (used for deterministic failover). */
let clientSequenceNumber = -1;

/** True during intentional shutdown — suppresses reconnect attempts. */
let shuttingDown = false;

/** Port used for reconnection attempts. */
let reconnectPort = 9242;

// ── Accessors ──────────────────────────────────────────────────────────────

export function getClientSocket(): WSClient | null {
  return clientSocket;
}

export function setClientSocket(ws: WSClient | null): void {
  clientSocket = ws;
}

export function getClientSequenceNumber(): number {
  return clientSequenceNumber;
}

export function setClientSequenceNumber(n: number): void {
  clientSequenceNumber = n;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function setShuttingDown(v: boolean): void {
  shuttingDown = v;
}

export function getReconnectPort(): number {
  return reconnectPort;
}

export function setReconnectPort(p: number): void {
  reconnectPort = p;
}

/** Clear client-mode state (for shutdown / restart). */
export function clearClientState(): void {
  if (clientSocket) {
    try {
      clientSocket.close();
    } catch {
      /* already closed */
    }
    clientSocket = null;
  }
  clientSequenceNumber = -1;
  shuttingDown = false;
}

// ── tryConnectAsClient ─────────────────────────────────────────────────────

/**
 * Result of a successful client connection attempt.
 */
export interface ClientConnection {
  /** The raw WebSocket to the owner server. */
  ws: WSClient;
  /** The port we connected on (echoed for convenience). */
  port: number;
}

/**
 * Try to connect to an existing owner server as a client.
 *
 * Creates a WebSocket to `ws://localhost:{port}/client`, waits for the
 * welcome handshake (which assigns a failover sequence number), and
 * returns the live socket.
 *
 * The caller is responsible for:
 * - Attaching a `message` handler to route incoming data (via
 *   `onMessage`).
 * - Attaching a `close` handler to detect disconnection and trigger
 *   failover.
 *
 * @param port — The owner server port.
 * @param onMessage — Callback for every incoming message (after welcome
 *   interception).  Typically wired to `handleMessage` from the transport.
 * @returns `null` if no owner server is reachable within 1.5 s, or a
 *   {@link ClientConnection} on success.
 */
export function tryConnectAsClient(
  port: number,
  onMessage: (data: string) => void,
): Promise<ClientConnection | null> {
  return new Promise((resolve) => {
    const url = `ws://localhost:${port}/client`;
    const ws = new WSClient(url);

    const timeout = setTimeout(() => {
      ws.close();
      resolve(null);
    }, 1500);

    ws.on("open", () => {
      clearTimeout(timeout);

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
              logger.info(
                `Connected as client to owner server on port ${port} ` +
                  `(sequence ${clientSequenceNumber})`,
              );
              return;
            }
          } catch {
            // Not JSON or not a welcome message — fall through to onMessage
          }
        }

        // Forward all other messages to the transport layer
        onMessage(raw);
      });

      ws.on("error", (err) => {
        logger.error("Client socket error:", err.message);
      });

      resolve({ ws, port });
    });

    ws.on("error", () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

/**
 * Close the current client socket (if any).
 * Safe to call when no client socket is active.
 */
export function closeClientSocket(): void {
  if (clientSocket) {
    try {
      clientSocket.close();
    } catch {
      /* already closed */
    }
    clientSocket = null;
  }
}
