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

export type { ClientConnection } from "./ws-failover.js";
export {
	clearClientState,
	closeClientSocket,
	getClientSequenceNumber,
	getClientSocket,
	getReconnectPort,
	isShuttingDown,
	setClientSequenceNumber,
	setClientSocket,
	setReconnectPort,
	setShuttingDown,
	tryConnectAsClient,
} from "./ws-failover.js";
export type { ServerHandle } from "./ws-server.js";
export {
	onResponse,
	send,
	start,
	stop,
} from "./ws-server.js";
export type { PendingRequest, ResponseHandler } from "./ws-transport.js";
export {
	addWsConnection,
	assignClientSequence,
	cleanupClientRequests,
	clearRelayState,
	clearResponseHandlers,
	closeAllWsConnections,
	createBridgeTransport,
	getAnyConnection,
	getWsConnectionCount,
	handleClientMessage,
	handleMessage,
	rejectAllPending,
	removeClientSequence,
	removeWsConnection,
} from "./ws-transport.js";
