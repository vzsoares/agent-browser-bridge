/**
 * Bridge server — lifecycle, routing, authentication and failover
 * orchestration, on `Bun.serve`.
 *
 * Routes:
 * - `/` — the Chrome extension. The upgrade needs the pinned extension
 *   Origin; the first frame must be a `hello` with the pairing token.
 * - `/client` — other bridge instances in client mode (host failover).
 *   Present only when `clientRoute` is on; refuses any Origin header and
 *   needs the per-start client token.
 *
 * Refused upgrades get a real 403/404 response before any upgrade.
 * `start()` tries client mode first (when the client route is on) and
 * falls back to owner mode. `stop()` tears everything down.
 *
 * @module infrastructure/ws-server
 */

import { createLogger } from "@agent-browser-bridge/logger";
import type { Server, ServerWebSocket } from "bun";
import { Hono } from "hono";

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

type Route = "extension" | "client";

interface SocketData {
	route: Route;
	authed: boolean;
	timer: ReturnType<typeof setTimeout> | null;
}

type BridgeServerSocket = ServerWebSocket<SocketData>;

// ── Server instance state ──────────────────────────────────────────────────

let server: Server<SocketData> | null = null;
let serverHandle: InternalServerHandle | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let options: BridgeOptions = resolveBridgeOptions();

// ── HTTP routes (non-upgrade) ──────────────────────────────────────────────

function createApp(clientRoute: boolean): Hono {
	const app = new Hono();
	app.get("/", (c) => c.text("Agent Browser Bridge — WebSocket server", 200));
	if (clientRoute) {
		app.get("/client", (c) =>
			c.text("Agent Browser Bridge — client endpoint", 200),
		);
	}
	return app;
}

// ── Upgrade gate ───────────────────────────────────────────────────────────

/** The route an upgrade may use, or the HTTP status refusing it. */
export function upgradeDecision(
	pathname: string,
	origin: string | null,
	opts: Pick<BridgeOptions, "clientRoute" | "extensionId">,
): Route | 403 | 404 {
	if (pathname === "/") {
		return isExtensionOrigin(origin ?? undefined, opts.extensionId)
			? "extension"
			: 403;
	}
	if (pathname === "/client" && opts.clientRoute) {
		return origin === null ? "client" : 403;
	}
	return 404;
}

// ── Authenticated socket handling ──────────────────────────────────────────

function rejectSocket(ws: BridgeServerSocket, why: string): void {
	logger.warn(`${ws.data.route}: rejected (${why})`);
	ws.close(UNAUTHORIZED_CLOSE_CODE, "Unauthorized");
}

function onAuthed(ws: BridgeServerSocket): void {
	if (ws.data.route === "extension") {
		replaceExtensionConnection(ws, REPLACED_CLOSE_CODE);
		logger.info("Chrome extension connected");
		return;
	}
	const seq = assignClientSequence(ws);
	ws.send(JSON.stringify({ type: "welcome", sequence: seq }));
	logger.info(`Bridge client connected (sequence ${seq})`);
}

/** Nothing is relayed before the hello matches; the hello is never relayed. */
function onSocketMessage(
	ws: BridgeServerSocket,
	message: string | Buffer,
	expectedToken: string,
): void {
	const data = typeof message === "string" ? message : null;
	if (ws.data.authed) {
		if (data === null) return;
		if (ws.data.route === "extension") handleMessage(data);
		else handleClientMessage(data, ws, getAnyConnection);
		return;
	}
	if (ws.data.timer) clearTimeout(ws.data.timer);
	ws.data.timer = null;
	const token = data === null ? null : parseHello(data);
	if (token === null || !tokensEqual(token, expectedToken)) {
		rejectSocket(
			ws,
			token === null ? "first frame is not a hello" : "bad token",
		);
		return;
	}
	ws.data.authed = true;
	onAuthed(ws);
}

function onSocketClose(ws: BridgeServerSocket): void {
	if (ws.data.timer) clearTimeout(ws.data.timer);
	ws.data.timer = null;
	if (!ws.data.authed) return;
	if (ws.data.route === "extension") {
		removeWsConnection(ws);
		logger.info("Chrome extension disconnected");
		if (getWsConnectionCount() === 0) rejectAllPending();
		return;
	}
	const seq = removeClientSequence(ws);
	logger.info(`Bridge client disconnected (sequence ${seq})`);
	cleanupClientRequests(ws);
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

function startAsOwner(effectivePort: number): InternalServerHandle | null {
	const pairToken = loadOrCreateTokenFile(options.pairTokenFile);
	const clientToken = options.clientRoute ? generateToken() : "";
	const tokens: Record<Route, string> = {
		extension: pairToken,
		client: clientToken,
	};
	const app = createApp(options.clientRoute);
	const opts = options;

	try {
		server = Bun.serve<SocketData>({
			port: effectivePort,
			hostname: opts.host,
			fetch(req, srv) {
				if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
					return app.fetch(req);
				}
				const decision = upgradeDecision(
					new URL(req.url).pathname,
					req.headers.get("origin"),
					opts,
				);
				if (decision === 403 || decision === 404) {
					logger.warn(`Upgrade refused with ${decision}`);
					return new Response(decision === 403 ? "Forbidden" : "Not Found", {
						status: decision,
					});
				}
				const data: SocketData = {
					route: decision,
					authed: false,
					timer: null,
				};
				if (srv.upgrade(req, { data })) return undefined;
				return new Response("Upgrade failed", { status: 400 });
			},
			websocket: {
				open(ws) {
					ws.data.timer = setTimeout(
						() => rejectSocket(ws, "no hello in time"),
						HELLO_TIMEOUT_MS,
					);
				},
				message(ws, message) {
					onSocketMessage(ws, message, tokens[ws.data.route]);
				},
				close(ws) {
					onSocketClose(ws);
				},
			},
		});
	} catch (err) {
		const code =
			typeof err === "object" && err !== null && "code" in err ? err.code : "";
		logger.warn(`Cannot listen on port ${effectivePort}: ${String(code)}`);
		server = null;
		if (code === "EADDRINUSE" && opts.clientRoute && !isShuttingDown()) {
			scheduleReconnect(effectivePort, 1000);
		}
		return null;
	}

	if (opts.clientRoute) writeTokenFile(opts.clientTokenFile, clientToken);

	const running = server;
	const boundPort = running.port ?? effectivePort;
	logger.info(`Owner server listening on ${opts.host}:${boundPort}`);

	serverHandle = {
		port: boundPort,
		_stop: () => {
			closeAllWsConnections();
			clearRelayState();
			running.stop(true);
			if (server === running) server = null;
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
	if (server !== null || getClientSocket() !== null) {
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

	const owner = startAsOwner(options.port);
	if (owner) return owner;
	// With the client route on, failover keeps retrying in the background.
	if (options.clientRoute) return { port: options.port, _stop: () => {} };
	throw new Error(`Port ${options.port} is in use on ${options.host}`);
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
