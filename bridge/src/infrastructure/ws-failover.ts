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

import { createLogger } from "@agent-browser-bridge/logger";
import { WebSocket as WSClient } from "ws";
import { readTokenFile } from "./auth.js";

const logger = createLogger("bridge:failover");

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

/** Host to dial for a server bound to `bindHost`. */
export function dialHost(bindHost: string): string {
	if (bindHost === "0.0.0.0" || bindHost === "") return "127.0.0.1";
	if (bindHost === "::") return "[::1]";
	return bindHost.includes(":") ? `[${bindHost}]` : bindHost;
}

/**
 * Try to connect to an existing owner server as a client.
 *
 * Dials `/client`, sends the `hello` with the token read from
 * `tokenFile`, and resolves once the owner's welcome (which assigns the
 * failover sequence) arrives. Resolves `null` when there is no token, no
 * owner within 1.5 s, or the owner closes before welcoming (e.g. 4401).
 *
 * The caller attaches the `close` handler that triggers failover.
 */
export function tryConnectAsClient(
	port: number,
	bindHost: string,
	tokenFile: string,
	onMessage: (data: string) => void,
): Promise<ClientConnection | null> {
	const token = readTokenFile(tokenFile);
	if (token === null) return Promise.resolve(null);

	return new Promise((resolve) => {
		const ws = new WSClient(`ws://${dialHost(bindHost)}:${port}/client`);
		let settled = false;
		const finish = (result: ClientConnection | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (!result) ws.terminate();
			resolve(result);
		};
		const timeout = setTimeout(() => finish(null), 1500);

		ws.on("open", () => {
			ws.send(JSON.stringify({ type: "hello", token }));
		});

		ws.on("message", (data) => {
			const raw = data.toString();
			if (!settled) {
				const sequence = parseWelcome(raw);
				if (sequence !== null) {
					clientSequenceNumber = sequence;
					logger.info(
						`Connected as client to owner on port ${port} (sequence ${sequence})`,
					);
					finish({ ws, port });
				}
				return;
			}
			onMessage(raw);
		});

		ws.on("close", () => finish(null));
		ws.on("error", (err) => {
			if (settled) logger.error("Client socket error:", err.message);
			else finish(null);
		});
	});
}

function parseWelcome(raw: string): number | null {
	let msg: unknown;
	try {
		msg = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof msg !== "object" || msg === null) return null;
	if (!("type" in msg) || msg.type !== "welcome") return null;
	if (!("sequence" in msg) || typeof msg.sequence !== "number") return null;
	return msg.sequence;
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
