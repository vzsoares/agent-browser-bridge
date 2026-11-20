/**
 * Hono WebSocket server — lifecycle, routing, authentication and failover
 * orchestration.
 *
 * Routes:
 * - `/` — the Chrome extension. The upgrade needs the pinned extension
 *   Origin; the first frame must be a `hello` with the pairing token.
 * - `/client` — other bridge instances in client mode (host failover).
 *   Present only when `clientRoute` is on; refuses any Origin header and
 *   needs the per-start client token.
 *
 * `start()` tries client mode first (when the client route is on) and
 * falls back to owner mode. `stop()` tears everything down.
 *
 * @module infrastructure/ws-server
 */

import { createLogger } from "@agent-browser-bridge/logger";
import { serve, upgradeWebSocket } from "@hono/node-server";
import { Hono } from "hono";
import type { WSContext, WSEvents } from "hono/ws";
import { type WebSocket, WebSocketServer } from "ws";

import type { ServerHandle } from "../domain/ports.js";
import {
	type BridgeOptions,
	generateToken,
	HELLO_TIMEOUT_MS,
	isExtensionOrigin,
	loadOrCreateTokenFile,
	parseHello,
	REPLACED_CLOSE_CODE,
	resolveBridgeOptions,
	tokensEqual,
	UNAUTHORIZED_CLOSE_CODE,
	writeTokenFile,
} from "./auth.js";
import {
	closeClientSocket,
	getClientSequenceNumber,
	getClientSocket,
	isShuttingDown,
	setClientSequenceNumber,
	setClientSocket,
	setReconnectPort,
	setShuttingDown,
	tryConnectAsClient,
} from "./ws-failover.js";
import {
	assignClientSequence,
	cleanupClientRequests,
	clearRelayState,
	clearResponseHandlers,
	closeAllWsConnections,
	getAnyConnection,
	getWsConnectionCount,
	handleClientMessage,
	handleMessage,
	onResponse,
	rejectAllPending,
	removeClientSequence,
	removeWsConnection,
	replaceExtensionConnection,
	send,
} from "./ws-transport.js";

const logger = createLogger("bridge:server");

/** Internal handle with a `_stop` method for lifecycle management. */
interface InternalServerHandle extends ServerHandle {
	/** @internal Stop the server (prefer the public {@link stop} function). */
	_stop: () => void;
}

// ── Server instance state ──────────────────────────────────────────────────

let wss: WebSocketServer | null = null;
let serverHandle: InternalServerHandle | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let options: BridgeOptions = resolveBridgeOptions();

// ── Authenticated socket events ────────────────────────────────────────────

/**
 * Wrap a route's events with the first-frame `hello` check. Nothing reaches
 * `onAuthed`/`onData` before the token matches; the hello is never relayed.
 */
function authenticated(
	expectedToken: () => string,
	label: string,
	handlers: {
		onAuthed: (raw: WebSocket) => void;
		onData: (data: string, raw: WebSocket) => void;
		onAuthedClose: (raw: WebSocket) => void;
	},
): WSEvents<WebSocket> {
	let authed = false;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const reject = (ws: WSContext<WebSocket>, why: string) => {
		logger.warn(`${label}: rejected (${why})`);
		ws.close(UNAUTHORIZED_CLOSE_CODE, "Unauthorized");
	};

	return {
		onOpen(_event, ws) {
			timer = setTimeout(
				() => reject(ws, "no hello in time"),
				HELLO_TIMEOUT_MS,
			);
		},
		onMessage(event, ws) {
			const raw = ws.raw;
			if (!raw) return;
			const data = typeof event.data === "string" ? event.data : null;
			if (authed) {
				if (data !== null) handlers.onData(data, raw);
				return;
			}
			if (timer) clearTimeout(timer);
			timer = null;
			const token = data === null ? null : parseHello(data);
			if (token === null || !tokensEqual(token, expectedToken())) {
				reject(ws, token === null ? "first frame is not a hello" : "bad token");
				return;
			}
			authed = true;
			handlers.onAuthed(raw);
		},
		onClose(_event, ws) {
			if (timer) clearTimeout(timer);
			timer = null;
			if (authed && ws.raw) handlers.onAuthedClose(ws.raw);
		},
		onError(error) {
			logger.error(`${label} WebSocket error:`, error);
		},
	};
}

// ── Hono app ───────────────────────────────────────────────────────────────

function isUpgrade(upgradeHeader: string | undefined): boolean {
	return upgradeHeader?.toLowerCase() === "websocket";
}

function createApp(
	opts: BridgeOptions,
	pairToken: string,
	clientToken: string,
): Hono {
	const app = new Hono();

	app.get(
		"/",
		async (c, next) => {
			if (
				isUpgrade(c.req.header("upgrade")) &&
				!isExtensionOrigin(c.req.header("origin"), opts.extensionId)
			) {
				logger.warn("Extension upgrade refused: Origin is not the extension");
				return c.text("Forbidden", 403);
			}
			await next();
		},
		upgradeWebSocket(() =>
			authenticated(() => pairToken, "Extension", {
				onAuthed(raw) {
					replaceExtensionConnection(raw, REPLACED_CLOSE_CODE);
					logger.info("Chrome extension connected");
				},
				onData(data) {
					handleMessage(data);
				},
				onAuthedClose(raw) {
					removeWsConnection(raw);
					logger.info("Chrome extension disconnected");
					if (getWsConnectionCount() === 0) rejectAllPending();
				},
			}),
		),
	);
	app.get("/", (c) => c.text("Agent Browser Bridge — WebSocket server", 200));

	if (!opts.clientRoute) return app;

	app.get(
		"/client",
		async (c, next) => {
			if (isUpgrade(c.req.header("upgrade")) && c.req.header("origin")) {
				logger.warn("Client upgrade refused: Origin header present");
				return c.text("Forbidden", 403);
			}
			await next();
		},
		upgradeWebSocket(() =>
			authenticated(() => clientToken, "Client", {
				onAuthed(raw) {
					const seq = assignClientSequence(raw);
					try {
						raw.send(JSON.stringify({ type: "welcome", sequence: seq }));
					} catch {
						/* client closed before the welcome */
					}
					logger.info(`Bridge client connected (sequence ${seq})`);
				},
				onData(data, raw) {
					handleClientMessage(data, raw, getAnyConnection);
				},
				onAuthedClose(raw) {
					const seq = removeClientSequence(raw);
					logger.info(`Bridge client disconnected (sequence ${seq})`);
					cleanupClientRequests(raw);
				},
			}),
		),
	);
	app.get("/client", (c) =>
		c.text("Agent Browser Bridge — client endpoint", 200),
	);

	return app;
}

// ── Client mode ────────────────────────────────────────────────────────────

/** Connect as a client and wire failover on close. Returns false if no owner. */
async function connectAsClient(port: number): Promise<boolean> {
	const result = await tryConnectAsClient(
		port,
		options.host,
		options.clientTokenFile,
		handleMessage,
	);
	if (!result) return false;

	setClientSocket(result.ws);
	result.ws.on("close", () => {
		setClientSocket(null);
		if (isShuttingDown()) {
			logger.info("Client disconnected (shutting down)");
			return;
		}
		logger.warn("Lost connection to owner server — will attempt failover");
		rejectAllPending();
		scheduleReconnect(port);
	});
	return true;
}

/**
 * Schedule a failover attempt. Clients wait `sequence * 300ms` (plus
 * `minDelay`) so they don't race to become owner.
 */
function scheduleReconnect(port: number, minDelay = 0): void {
	if (isShuttingDown()) return;
	if (reconnectTimer) clearTimeout(reconnectTimer);

	const delay = minDelay + Math.max(0, getClientSequenceNumber()) * 300;
	logger.info(`Failover scheduled in ${delay}ms`);

	reconnectTimer = setTimeout(async () => {
		reconnectTimer = null;
		if (isShuttingDown()) return;
		if (await connectAsClient(port)) {
			logger.info("Another instance is owner — reconnected as client");
			return;
		}
		logger.info("No owner found, taking over as owner...");
		startAsOwner(port);
	}, delay);
}

// ── Owner mode ─────────────────────────────────────────────────────────────

function startAsOwner(effectivePort: number): InternalServerHandle {
	const pairToken = loadOrCreateTokenFile(options.pairTokenFile);
	let clientToken = "";
	if (options.clientRoute) {
		clientToken = generateToken();
		writeTokenFile(options.clientTokenFile, clientToken);
	}

	wss = new WebSocketServer({ noServer: true });
	const app = createApp(options, pairToken, clientToken);

	const httpServer = serve({
		fetch: app.fetch,
		port: effectivePort,
		hostname: options.host,
		websocket: { server: wss },
	});

	httpServer.on("error", (err: NodeJS.ErrnoException) => {
		if (err.code === "EADDRINUSE") {
			logger.warn(`Port ${effectivePort} is already in use`);
		} else {
			logger.error(`Server error on port ${effectivePort}:`, err.message);
		}
		if (wss) {
			wss.close();
			wss = null;
		}
		serverHandle = null;
		rejectAllPending();
		clearResponseHandlers();

		if (err.code === "EADDRINUSE" && options.clientRoute && !isShuttingDown()) {
			scheduleReconnect(effectivePort, 1000);
		}
	});

	const addr = httpServer.address();
	const boundPort =
		typeof addr === "object" && addr !== null ? addr.port : effectivePort;

	logger.info(`Owner server listening on ${options.host}:${boundPort}`);

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

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Start the bridge. Options not given come from the environment
 * (`AGENT_BROWSER_PORT`, `AGENT_BROWSER_HOST`, `AGENT_BROWSER_CLIENT`,
 * `AGENT_BROWSER_EXTENSION_ID`, `AGENT_BROWSER_PAIR_TOKEN_FILE`).
 * Port `0` lets the OS pick a free port (owner mode only).
 */
export async function start(
	overrides: Partial<BridgeOptions> = {},
): Promise<InternalServerHandle> {
	if (wss !== null || getClientSocket() !== null) {
		stop();
	}

	options = resolveBridgeOptions(overrides);
	setReconnectPort(options.port);
	setShuttingDown(false);

	if (options.clientRoute && (await connectAsClient(options.port))) {
		return {
			port: options.port,
			_stop: () => {
				closeClientSocket();
				setClientSocket(null);
			},
		};
	}

	return startAsOwner(options.port);
}

/**
 * Gracefully shut down: close connections, reject pending requests with
 * `BROWSER_NOT_CONNECTED`, and clear response subscribers.
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

export type { BridgeOptions, ServerHandle };
export { onResponse, send };
