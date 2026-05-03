/**
 * WebSocket transport — implements {@link BridgeTransport} over raw WebSocket
 * connections.
 *
 * Manages connection state, pending-request correlation, response
 * subscriptions, and client-proxy relay mappings.  All mutable state is
 * module-private; the exported functions are the only entry points.
 *
 * This module does **not** import from `ws-failover.ts` or `ws-server.ts`.
 * It depends only on domain types / errors, the shared protocol, and the
 * logger.
 *
 * @module infrastructure/ws-transport
 */

import { WebSocket as WSClient, type WebSocket } from "ws";

import type {
  Action,
  ErrorResponse,
  Request,
  Response,
} from "@pi-browser-bridge/protocol";

import { createLogger } from "@pi-browser-bridge/logger";

import type { BridgeTransport } from "../domain/ports.js";
import {
  createNotConnectedError,
  createOwnerNotConnectedError,
  createSendFailedError,
  createTimeoutError,
} from "../domain/errors.js";

import { getClientSocket } from "./ws-failover.js";

const logger = createLogger("pi-bridge:transport");

// ── Types ──────────────────────────────────────────────────────────────────

/** A pending request waiting for a matching response from the browser. */
export interface PendingRequest {
  resolve: (response: Response) => void;
  reject: (error: ErrorResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Subscriber callback for unsolicited responses. */
export type ResponseHandler = (response: Response) => void;

// ── Module-private state ───────────────────────────────────────────────────

/** Active Chrome-extension WebSocket connections (owner mode). */
const wsConnections = new Set<WebSocket>();

/** Pending requests keyed by their correlation id. */
const pendingRequests = new Map<string, PendingRequest>();

/** Active response subscribers. */
const responseHandlers = new Set<ResponseHandler>();

/**
 * Maps request id → pi client WebSocket so the owner can relay responses
 * back to the correct client.
 */
const clientToRequest = new Map<string, WebSocket>();

/** Timeouts for client-proxied requests (owner mode). */
const requestTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Maps pi client WebSocket → assigned sequence number. */
const clientSequences = new Map<WebSocket, number>();

/** Next sequence number to assign to a connecting pi client. */
let nextClientSequence = 0;

// ── Constants ──────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

// ── Connection tracking ────────────────────────────────────────────────────

/** Register a Chrome-extension WebSocket connection (owner mode). */
export function addWsConnection(ws: WebSocket): void {
  wsConnections.add(ws);
}

/** Unregister a Chrome-extension WebSocket connection. */
export function removeWsConnection(ws: WebSocket): void {
  wsConnections.delete(ws);
}

/** Number of active Chrome-extension connections. */
export function getWsConnectionCount(): number {
  return wsConnections.size;
}

/** Get the first active Chrome-extension WebSocket (or undefined). */
export function getAnyConnection(): WebSocket | undefined {
  return wsConnections.values().next().value;
}

/** Close and remove all tracked connections. */
export function closeAllWsConnections(): void {
  for (const ws of wsConnections) {
    try {
      ws.close(1000, "Server shutting down");
    } catch {
      /* connection already closed — ignore */
    }
  }
  wsConnections.clear();
}

// ── Pending request management ─────────────────────────────────────────────

/** Register a pending request so its matching response can resolve it. */
export function addPendingRequest(
  id: string,
  pr: PendingRequest,
): void {
  pendingRequests.set(id, pr);
}

/** Resolve a pending request by id. Returns `true` if one was found. */
export function resolvePendingRequest(
  id: string,
  response: Response,
): void {
  const pending = pendingRequests.get(id);
  if (pending) {
    clearTimeout(pending.timer);
    pendingRequests.delete(id);
    pending.resolve(response);
  }
}

/** Reject every pending request with `BROWSER_NOT_CONNECTED`. */
export function rejectAllPending(): void {
  const error = createNotConnectedError();
  for (const [_id, pending] of pendingRequests) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  pendingRequests.clear();
}

// ── Response subscriptions ─────────────────────────────────────────────────

/** Register a response subscriber. Returns an unsubscribe function. */
export function addResponseHandler(handler: ResponseHandler): () => void {
  responseHandlers.add(handler);
  return () => {
    responseHandlers.delete(handler);
  };
}

/** Notify all subscribers of an incoming response. */
export function notifyResponseHandlers(response: Response): void {
  for (const handler of responseHandlers) {
    try {
      handler(response);
    } catch (err) {
      logger.error("Error in response handler:", err);
    }
  }
}

/** Remove all response subscribers. */
export function clearResponseHandlers(): void {
  responseHandlers.clear();
}

// ── Client relay (owner mode) ──────────────────────────────────────────────

/** Map a request id to the pi client that proxied it. */
export function mapClientRequest(id: string, clientWs: WebSocket): void {
  clientToRequest.set(id, clientWs);
}

/** Start a timeout for a client-proxied request. */
export function startClientRequestTimeout(
  id: string,
  clientWs: WebSocket,
): void {
  const timer = setTimeout(() => {
    clientToRequest.delete(id);
    requestTimers.delete(id);
    try {
      clientWs.send(
        JSON.stringify({
          id,
          error: createTimeoutError(id, REQUEST_TIMEOUT_MS),
        }),
      );
    } catch {
      /* client already gone */
    }
  }, REQUEST_TIMEOUT_MS);
  requestTimers.set(id, timer);
}

/** Resolve a client-proxied request and relay the response. */
export function resolveClientRequest(
  id: string,
  data: string,
): void {
  const clientWs = clientToRequest.get(id);
  if (!clientWs) return;

  clientToRequest.delete(id);
  const timer = requestTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    requestTimers.delete(id);
  }
  try {
    clientWs.send(data);
  } catch {
    /* client disconnected — ignore */
  }
}

/** Clean up all relay state for a disconnected pi client. */
export function cleanupClientRequests(clientWs: WebSocket): void {
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

/** Clear all client relay state (for shutdown). */
export function clearRelayState(): void {
  for (const timer of requestTimers.values()) {
    clearTimeout(timer);
  }
  requestTimers.clear();
  clientToRequest.clear();
  clientSequences.clear();
  nextClientSequence = 0;
}

// ── Client sequence (owner mode) ───────────────────────────────────────────

/** Assign a sequence number to a newly connected pi client. */
export function assignClientSequence(ws: WebSocket): number {
  const seq = nextClientSequence++;
  clientSequences.set(ws, seq);
  return seq;
}

/** Remove a pi client from sequence tracking. */
export function removeClientSequence(ws: WebSocket): number {
  const seq = clientSequences.get(ws) ?? -1;
  clientSequences.delete(ws);
  return seq;
}

// ── Message handling ───────────────────────────────────────────────────────

/**
 * Handle a message from the Chrome extension (owner mode).
 * Resolves pending local requests, relays proxied responses to
 * pi clients, and notifies subscribers.
 */
export function handleMessage(data: string): void {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    logger.error("Failed to parse incoming JSON:", data.slice(0, 200));
    return;
  }

  if (typeof message !== "object" || message === null) {
    logger.error("Received non-object message:", typeof message);
    return;
  }

  const response = message as Record<string, unknown>;

  // Protocol-level keepalive — silently ignore
  if (response.type === "ping") return;

  if (typeof response.id !== "string" || response.id.length === 0) {
    logger.error("Received message without valid id:", data.slice(0, 200));
    return;
  }

  const responseId: string = response.id;
  const typedResponse = message as Response;

  // ── Relay to pi client if this response belongs to a proxied request ──
  resolveClientRequest(responseId, data);

  // ── Resolve local pending request ──
  resolvePendingRequest(responseId, typedResponse);

  // ── Notify all subscribers ──
  notifyResponseHandlers(typedResponse);
}

/**
 * Handle a message from a pi client (owner mode).
 * Forwards the request to the Chrome extension and records the
 * mapping so the response can be relayed back.
 */
export function handleClientMessage(
  data: string,
  clientWs: WebSocket,
  getConnection: () => WebSocket | undefined,
): void {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    logger.error("Failed to parse client JSON:", data.slice(0, 200));
    return;
  }

  if (typeof message !== "object" || message === null) return;

  const request = message as Record<string, unknown>;

  // Keepalive — silently ignore
  if (request.type === "ping") return;

  if (typeof request.id !== "string" || request.id.length === 0) {
    logger.error(
      "Client sent message without valid id:",
      data.slice(0, 200),
    );
    return;
  }

  const requestId: string = request.id;

  // Forward to Chrome extension
  const browserWs = getConnection();
  if (!browserWs) {
    clientWs.send(
      JSON.stringify({
        id: requestId,
        error: createNotConnectedError(),
      }),
    );
    return;
  }

  // Record mapping for relay
  mapClientRequest(requestId, clientWs);
  startClientRequestTimeout(requestId, clientWs);

  try {
    browserWs.send(data);
  } catch {
    // Clean up on send failure
    const timer = requestTimers.get(requestId);
    if (timer) {
      clearTimeout(timer);
      requestTimers.delete(requestId);
    }
    clientToRequest.delete(requestId);
    try {
      clientWs.send(
        JSON.stringify({
          id: requestId,
          error: createSendFailedError(),
        }),
      );
    } catch {
      /* client already gone */
    }
  }
}

// ── Core API: send ─────────────────────────────────────────────────────────

/**
 * Send a {@link Request} to the connected browser extension and return a
 * promise that resolves with the matching {@link Response}.
 *
 * In owner mode, sends directly over the Chrome extension WebSocket.
 * In client mode, sends over the client WebSocket to the owner server,
 * which relays to the Chrome extension and back.
 *
 * @typeParam A — Concrete action. Defaults to the full {@link Action} union.
 */
export function send<A extends Action = Action>(
  request: Request<A>,
): Promise<Response<A>> {
  return sendWithRetry(request, 1) as Promise<Response<A>>;
}

/**
 * Internal: attempt to send a request, retrying on transient connection
 * failures up to {@link MAX_RETRIES} times.
 */
function sendWithRetry<A extends Action = Action>(
  request: Request<A>,
  attempt: number,
): Promise<Response<A> | ErrorResponse> {
  // Client mode: forward through the owner server
  const clientWs = getClientSocket();
  if (clientWs) {
    return sendViaClient(request, clientWs, attempt);
  }

  // Owner mode: send directly to the Chrome extension
  const ws = wsConnections.values().next().value;
  if (!ws) {
    if (attempt <= MAX_RETRIES) {
      return waitForConnection(RETRY_DELAY_MS * attempt).then((reconnected) => {
        if (reconnected) {
          return sendWithRetry(request, attempt + 1);
        }
        return Promise.reject(createNotConnectedError());
      });
    }
    return Promise.reject(createNotConnectedError());
  }

  const id = request.id ?? crypto.randomUUID();
  const outgoing = { ...request, id };

  return new Promise<Response<A>>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(createTimeoutError(id, REQUEST_TIMEOUT_MS));
    }, REQUEST_TIMEOUT_MS);

    addPendingRequest(id, { resolve: resolve as (r: Response) => void, reject, timer });

    try {
      ws.send(JSON.stringify(outgoing));
    } catch {
      clearTimeout(timer);
      pendingRequests.delete(id);

      if (attempt <= MAX_RETRIES) {
        logger.warn(
          `Send failed for request ${id}, retrying (${attempt}/${MAX_RETRIES})...`,
        );
        setTimeout(() => {
          sendWithRetry(request, attempt + 1)
            .then((r) => resolve(r as Response<A>))
            .catch(reject);
        }, RETRY_DELAY_MS * attempt);
      } else {
        reject(createSendFailedError());
      }
    }
  }) as Promise<Response<A>>;
}

/**
 * Send a request over the client WebSocket to the owner server.
 */
function sendViaClient<A extends Action = Action>(
  request: Request<A>,
  clientWs: WebSocket,
  attempt: number,
): Promise<Response<A> | ErrorResponse> {
  if (clientWs.readyState !== WSClient.OPEN) {
    return Promise.reject(createOwnerNotConnectedError());
  }

  const id = request.id ?? crypto.randomUUID();
  const outgoing = { ...request, id };

  return new Promise<Response<A>>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(createTimeoutError(id, REQUEST_TIMEOUT_MS));
    }, REQUEST_TIMEOUT_MS);

    addPendingRequest(id, { resolve: resolve as (r: Response) => void, reject, timer });

    try {
      clientWs.send(JSON.stringify(outgoing));
    } catch {
      clearTimeout(timer);
      pendingRequests.delete(id);

      if (attempt <= MAX_RETRIES) {
        logger.warn(
          `Client send failed for request ${id}, retrying (${attempt}/${MAX_RETRIES})...`,
        );
        setTimeout(() => {
          sendViaClient(request, clientWs, attempt + 1)
            .then((r) => resolve(r as Response<A>))
            .catch(reject);
        }, RETRY_DELAY_MS * attempt);
      } else {
        reject(createOwnerNotConnectedError());
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

// ── Public API: onResponse ─────────────────────────────────────────────────

/**
 * Subscribe to all incoming responses, including unsolicited events that
 * do not correspond to a pending request.
 *
 * Returns an unsubscribe function.
 */
export function onResponse(handler: ResponseHandler): () => void {
  return addResponseHandler(handler);
}

// ── BridgeTransport factory ────────────────────────────────────────────────

/**
 * Create a {@link BridgeTransport} implementation backed by the module-level
 * WebSocket state.
 *
 * Useful for dependency-injecting the transport into use cases without
 * coupling them to the module-level singletons.
 */
export function createBridgeTransport(): BridgeTransport {
  return {
    send: send as BridgeTransport["send"],
    onResponse,
  };
}
