/**
 * Infrastructure layer barrel export.
 *
 * This module exports the concrete implementations of the domain port
 * interfaces (BridgeTransport, ServerLifecycle) backed by Hono + ws.
 *
 * It depends on the domain layer (ports, errors) and shared packages
 * (protocol, logger, hono, ws).  It does **not** import from the
 * application layer, tools, or chrome-extension.
 *
 * @module infrastructure
 */

export {
  start,
  stop,
  send,
  onResponse,
} from "./ws-server.js";

export type { ServerHandle } from "./ws-server.js";

export {
  createBridgeTransport,
  handleMessage,
  handleClientMessage,
  cleanupClientRequests,
  rejectAllPending,
  addWsConnection,
  removeWsConnection,
  getAnyConnection,
  getWsConnectionCount,
  closeAllWsConnections,
  clearResponseHandlers,
  clearRelayState,
  assignClientSequence,
  removeClientSequence,
} from "./ws-transport.js";

export type { PendingRequest, ResponseHandler } from "./ws-transport.js";

export {
  getClientSocket,
  setClientSocket,
  getClientSequenceNumber,
  setClientSequenceNumber,
  isShuttingDown,
  setShuttingDown,
  getReconnectPort,
  setReconnectPort,
  clearClientState,
  tryConnectAsClient,
  closeClientSocket,
} from "./ws-failover.js";

export type { ClientConnection } from "./ws-failover.js";
