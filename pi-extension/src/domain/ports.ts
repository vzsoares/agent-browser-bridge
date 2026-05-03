/**
 * Port interfaces for dependency inversion (Clean Architecture).
 *
 * These interfaces define the contracts that outer layers (infrastructure,
 * adapters) must implement. The domain layer depends only on these
 * abstractions, never on concrete implementations.
 *
 * Zero dependencies on infrastructure packages (Hono, ws, pi SDK).
 * Only imports: protocol types.
 *
 * @module domain/ports
 */

import type {
  Action,
  ErrorResponse,
  Request,
  Response,
} from "@pi-browser-bridge/protocol";

// ── Bridge Transport ───────────────────────────────────────────────────────

/**
 * Abstraction for the message transport between the pi extension and the
 * browser extension.
 *
 * Implementations:
 * - `WebSocketBridge` (infrastructure) — WebSocket-based transport.
 * - `MockBridge` (tests) — in-memory transport for unit tests.
 */
export interface BridgeTransport {
  /**
   * Send a request to the browser extension and await the matching response.
   *
   * The promise rejects with a structured {@link ErrorResponse} on:
   * - Connection failure (`BROWSER_NOT_CONNECTED`)
   * - Timeout (`TIMEOUT`)
   *
   * @typeParam A — Concrete action literal.
   */
  send<A extends Action = Action>(
    request: Request<A>,
  ): Promise<Response<A>>;

  /**
   * Subscribe to all incoming responses, including unsolicited events that
   * do not correspond to a pending request.
   *
   * Returns an unsubscribe function.
   */
  onResponse(handler: (response: Response) => void): () => void;
}

// ── Server Lifecycle ───────────────────────────────────────────────────────

export interface ServerHandle {
  /** The port the server is bound to. */
  readonly port: number;
}

/**
 * Abstraction for the server lifecycle (start / stop).
 *
 * The server accepts WebSocket connections from the Chrome extension
 * and manages request/response correlation.
 *
 * Implementations:
 * - `WebSocketServerManager` (infrastructure) — Hono + ws server.
 */
export interface ServerLifecycle {
  /**
   * Start the server on the given port (or default).
   *
   * @param port — Override the default port. Pass `0` for OS-assigned port.
   * @returns A handle with the bound port number.
   */
  start(port?: number): Promise<ServerHandle>;

  /**
   * Gracefully shut down the server.
   *
   * All active connections are closed, pending requests are rejected,
   * and event listeners are cleaned up.
   */
  stop(): void;
}

// ── Allowlist Store ────────────────────────────────────────────────────────

/**
 * Abstraction for reading the current domain allowlist configuration.
 *
 * The allowlist controls which domains the browser extension is allowed
 * to navigate to and interact with.
 *
 * Implementations:
 * - `EnvAllowlistStore` (infrastructure) — reads from environment variables.
 * - `ExtensionAllowlistStore` (adapter) — reads from Chrome extension storage.
 */
export interface AllowlistStore {
  /**
   * Get the current allowlist.
   *
   * - `["*"]` means all domains are allowed.
   * - A list of domain patterns (e.g. `["example.com", "*.github.com"]`).
   * - An empty array means nothing is allowed.
   */
  getAllowlist(): readonly string[] | Promise<readonly string[]>;
}

// ── Notification Sink ──────────────────────────────────────────────────────

/**
 * Abstraction for sending user-visible notifications from the bridge.
 *
 * Used to surface connection status changes, errors, and warnings
 * in a transport-agnostic way.
 *
 * Implementations:
 * - `PiNotificationSink` (adapter) — forwards to pi's notification API.
 * - `ConsoleNotificationSink` (infrastructure) — logs to console.
 */
export interface NotificationSink {
  /** Informational message. */
  info(message: string): void;
  /** Warning message (non-fatal). */
  warn(message: string): void;
  /** Error message (fatal or near-fatal). */
  error(message: string, err?: unknown): void;
}
