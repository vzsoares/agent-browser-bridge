/**
 * WebSocket client with automatic reconnection and keep-alive.
 *
 * Manages a single WebSocket connection to the Bun server with:
 * - Exponential backoff on disconnect (capped at 30 s, reset on success).
 * - Keep-alive pings every 20 s to prevent Chrome from terminating the
 *   service worker.
 * - Status callbacks for the toolbar badge and popup UI.
 *
 * Infrastructure layer — imports only from domain/ and other
 * infrastructure modules.
 *
 * @module infrastructure/websocket-client
 */

import type { ConnectionStatus } from "./chrome-runtime.js";
import { setStatusBadge } from "./chrome-runtime.js";
import { saveBridgeConfig } from "./chrome-storage.js";

// ── Types ──────────────────────────────────────────────────────────────

/** Logger interface compatible with @pi-browser-bridge/logger. */
interface Logger {
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
}

/** Options for creating the WebSocket client. */
export interface WebSocketClientOptions {
	/** Initial port for the WebSocket URL. */
	port: number;
	/** Logger instance. */
	logger: Logger;
	/** Callback for every incoming message (raw string). */
	onMessage: (data: string) => void;
	/** Optional callback when connection status changes. */
	onStatusChange?: (status: ConnectionStatus) => void;
}

// ── Constants ──────────────────────────────────────────────────────────

/** Interval between keep-alive pings (ms). */
const KEEP_ALIVE_INTERVAL = 20_000;

/** Maximum reconnect backoff (ms). */
const MAX_BACKOFF = 30_000;

/** Initial backoff (ms). */
const INITIAL_BACKOFF = 1_000;

// ── WebSocket client ───────────────────────────────────────────────────

export class WebSocketClient {
	private ws: WebSocket | null = null;
	private port: number;
	private logger: Logger;
	private onMessage: (data: string) => void;
	private onStatusChange?: (status: ConnectionStatus) => void;

	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
	private reconnectAttempt = 0;

	constructor(options: WebSocketClientOptions) {
		this.port = options.port;
		this.logger = options.logger;
		this.onMessage = options.onMessage;
		this.onStatusChange = options.onStatusChange;
	}

	// ── Public API ──────────────────────────────────────────────────────

	/** Update the port (used when the user changes it in the popup). */
	setPort(port: number): void {
		this.port = port;
	}

	/** Return the current port. */
	getPort(): number {
		return this.port;
	}

	/** Connect (or reconnect) to the WebSocket server. */
	connect(): void {
		this.cancelReconnect();
		this.stopKeepAlive();
		this.updateStatus("connecting");

		// Suppress stale events from an existing connection before replacing it.
		this.cleanupStaleSocket();

		const url = `ws://localhost:${this.port}`;
		this.logger.info(`Connecting to ${url}…`);

		try {
			this.ws = new WebSocket(url);
		} catch (e) {
			this.logger.error(`Failed to create WebSocket: ${e}`);
			this.scheduleReconnect();
			return;
		}

		this.ws.onopen = () => {
			this.logger.info("WebSocket connected");
			this.reconnectAttempt = 0;
			this.startKeepAlive();
			this.updateStatus("connected");
		};

		this.ws.onclose = (event) => {
			this.logger.info(
				`WebSocket closed (code=${event.code}, reason="${event.reason || ""}", wasClean=${event.wasClean})`,
			);
			this.stopKeepAlive();
			this.ws = null;

			if (event.code !== 1000) {
				// 1000 = Normal Closure — don't reconnect for intentional shutdown.
				this.scheduleReconnect();
			} else {
				this.updateStatus("disconnected");
			}
		};

		this.ws.onerror = () => {
			this.logger.error(
				`WebSocket error. ReadyState: ${this.ws?.readyState ?? "null"}`,
			);
			// onclose fires after onerror, so reconnection is handled there.
		};

		this.ws.onmessage = (event) => {
			try {
				this.onMessage(
					typeof event.data === "string" ? event.data : String(event.data),
				);
			} catch (e) {
				this.logger.error(`Unhandled error in message callback: ${e}`);
			}
		};
	}

	/** Gracefully disconnect (sends close code 1000 — no reconnect). */
	disconnect(): void {
		this.cancelReconnect();
		this.stopKeepAlive();
		if (this.ws) {
			this.ws.onclose = null;
			this.ws.onerror = null;
			try {
				this.ws.close(1000, "Intentional shutdown");
			} catch {
				// Ignore.
			}
			this.ws = null;
		}
		this.updateStatus("disconnected");
	}

	/** Send a string over the WebSocket (no-op if not connected). */
	send(data: string): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(data);
		} else {
			this.logger.warn(
				`Cannot send — WebSocket is not open (readyState=${this.ws?.readyState ?? "null"})`,
			);
		}
	}

	/** Check whether the socket is currently open. */
	isOpen(): boolean {
		return this.ws?.readyState === WebSocket.OPEN;
	}

	// ── Private helpers ─────────────────────────────────────────────────

	private updateStatus(status: ConnectionStatus): void {
		void setStatusBadge(status);
		void saveBridgeConfig({
			connectionStatus: status,
			connectedAt:
				status === "connected" ? new Date().toISOString() : undefined,
		});
		this.onStatusChange?.(status);
	}

	private cleanupStaleSocket(): void {
		if (this.ws) {
			this.ws.onclose = null;
			this.ws.onerror = null;
			try {
				this.ws.close();
			} catch {
				// Ignore.
			}
			this.ws = null;
		}
	}

	private cancelReconnect(): void {
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}

	private scheduleReconnect(): void {
		this.cancelReconnect();
		this.reconnectAttempt++;
		const delay = Math.min(
			INITIAL_BACKOFF * 2 ** (this.reconnectAttempt - 1),
			MAX_BACKOFF,
		);
		this.logger.info(
			`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})…`,
		);
		this.updateStatus("connecting");
		this.reconnectTimer = setTimeout(() => this.connect(), delay);
	}

	private startKeepAlive(): void {
		this.stopKeepAlive();
		this.keepAliveTimer = setInterval(() => {
			if (this.ws?.readyState === WebSocket.OPEN) {
				try {
					this.ws.send(JSON.stringify({ type: "ping" }));
				} catch (e) {
					this.logger.warn(`Keep-alive ping failed: ${e}`);
				}
			}
		}, KEEP_ALIVE_INTERVAL);
	}

	private stopKeepAlive(): void {
		if (this.keepAliveTimer !== null) {
			clearInterval(this.keepAliveTimer);
			this.keepAliveTimer = null;
		}
	}
}
