/**
 * Typed mock for the browser WebSocket API.
 *
 * Simulates connection lifecycle, message sending, and event dispatch.
 * Compatible with the happy-dom environment (no native WebSocket in Node).
 *
 * Supports both `addEventListener` / `removeEventListener` (EventTarget API)
 * and `onopen` / `onclose` / `onerror` / `onmessage` property-style handlers.
 *
 * @module mock-websocket
 */

import { vi } from "vitest";

// ── Ready-state constants (hard-coded to avoid referencing global WebSocket) ─

const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSING = 2;
const WS_CLOSED = 3;

// ── Types ─────────────────────────────────────────────────────────────

export interface MockWebSocketOptions {
  /** URL the socket connects to. */
  url?: string;
  /** Whether the connection succeeds immediately. @default true */
  connectOnCreate?: boolean;
  /** Milliseconds before auto-connecting (0 = immediate). */
  connectDelay?: number;
}

export interface SentMessage {
  data: string | ArrayBufferLike | Blob | ArrayBufferView;
  timestamp: number;
}

/** Type for the event handler properties (onopen, onclose, etc.). */
type WSEventHandler = ((event: Event) => void) | null;

// ── Internal: dispatch helpers ────────────────────────────────────────

/**
 * Dispatch an event to both `addEventListener`-registered listeners
 * AND the corresponding `on{type}` property handler.
 */
function dispatchToAll(
  listeners: Record<string, Set<EventListenerOrEventListenerObject>>,
  onHandlerMap: Record<string, WSEventHandler>,
  event: Event,
): void {
  const set = listeners[event.type];
  if (set) {
    for (const listener of set) {
      if (typeof listener === "function") {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    }
  }

  // Also invoke the on* property handler (onopen, onmessage, etc.)
  const propName = `on${event.type}`;
  const handler = onHandlerMap[propName];
  if (handler) {
    handler(event);
  }
}

// ── Mock ──────────────────────────────────────────────────────────────

/**
 * Creates a mock WebSocket instance with tracked state.
 *
 * Usage:
 * ```ts
 * const ws = createMockWebSocket({ url: "ws://localhost:9242" });
 * // Simulate server message
 * ws.simulateMessage(JSON.stringify({ id: "1", result: {} }));
 * // Assert sent messages
 * expect(ws.sent).toHaveLength(1);
 * ```
 */
export function createMockWebSocket(options: MockWebSocketOptions = {}) {
  const connectOnCreate = options.connectOnCreate ?? true;
  const connectDelay = options.connectDelay ?? 0;

  let readyState: number = connectOnCreate ? WS_OPEN : WS_CONNECTING;
  const sent: SentMessage[] = [];
  const listeners: Record<string, Set<EventListenerOrEventListenerObject>> = {
    open: new Set(),
    message: new Set(),
    close: new Set(),
    error: new Set(),
  };

  /** on* property handlers — mirror the standard WebSocket API. */
  let onopen: WSEventHandler = null;
  let onclose: WSEventHandler = null;
  let onerror: WSEventHandler = null;
  let onmessage: WSEventHandler = null;

  /** Lookup table from event type → property handler for dispatch. */
  const onHandlerMap: Record<string, WSEventHandler> = {
    onopen,
    onclose,
    onerror,
    onmessage,
  };

  const ws = {
    // ── Properties ──────────────────────────────────────────────────

    url: options.url ?? "ws://localhost:9242",

    get readyState(): number {
      return readyState;
    },
    set readyState(value: number) {
      readyState = value;
    },

    CONNECTING: WS_CONNECTING,
    OPEN: WS_OPEN,
    CLOSING: WS_CLOSING,
    CLOSED: WS_CLOSED,
    bufferedAmount: 0,
    extensions: "",
    protocol: "",
    binaryType: "blob" as BinaryType,

    // ── on* event handler properties ────────────────────────────────

    get onopen(): WSEventHandler {
      return onopen;
    },
    set onopen(handler: WSEventHandler) {
      onopen = handler;
      onHandlerMap.onopen = handler;
    },

    get onclose(): WSEventHandler {
      return onclose;
    },
    set onclose(handler: WSEventHandler) {
      onclose = handler;
      onHandlerMap.onclose = handler;
    },

    get onerror(): WSEventHandler {
      return onerror;
    },
    set onerror(handler: WSEventHandler) {
      onerror = handler;
      onHandlerMap.onerror = handler;
    },

    get onmessage(): WSEventHandler {
      return onmessage;
    },
    set onmessage(handler: WSEventHandler) {
      onmessage = handler;
      onHandlerMap.onmessage = handler;
    },

    // ── Sent message log ────────────────────────────────────────────

    /** All messages sent via this mock socket. */
    sent,

    // ── Core methods ────────────────────────────────────────────────

    send: vi.fn((data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
      sent.push({ data, timestamp: Date.now() });
    }),

    close: vi.fn((code?: number, reason?: string) => {
      readyState = WS_CLOSED;
      ws.dispatchEvent(new CloseEvent("close", { code, reason, wasClean: true }));
    }),

    addEventListener: vi.fn(
      (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type in listeners) {
          listeners[type]!.add(listener);
        }
      },
    ),

    removeEventListener: vi.fn(
      (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type in listeners) {
          listeners[type]!.delete(listener);
        }
      },
    ),

    dispatchEvent: vi.fn((event: Event) => {
      dispatchToAll(listeners, onHandlerMap, event);
      return true;
    }),

    // ── Mock control methods ────────────────────────────────────────

    /**
     * Simulate a server message event.
     * Calls all registered `message` listeners and `onmessage` handler.
     */
    simulateMessage(data: unknown): void {
      const event = new MessageEvent("message", { data });
      dispatchToAll(listeners, onHandlerMap, event);
    },

    /**
     * Simulate a connection open event.
     * Calls all registered `open` listeners and `onopen` handler.
     */
    simulateOpen(): void {
      readyState = WS_OPEN;
      const event = new Event("open");
      dispatchToAll(listeners, onHandlerMap, event);
    },

    /**
     * Simulate a server disconnect.
     * Calls all registered `close` listeners and `onclose` handler.
     */
    simulateClose(code = 1000, reason = ""): void {
      readyState = WS_CLOSED;
      const event = new CloseEvent("close", { code, reason, wasClean: true });
      dispatchToAll(listeners, onHandlerMap, event);
    },

    /**
     * Simulate a connection error.
     * Calls all registered `error` listeners and `onerror` handler.
     */
    simulateError(): void {
      const event = new Event("error");
      dispatchToAll(listeners, onHandlerMap, event);
    },

    /**
     * Reset all tracked state (sent messages, listeners, handlers).
     */
    reset(): void {
      sent.length = 0;
      for (const key of Object.keys(listeners)) {
        listeners[key as keyof typeof listeners]!.clear();
      }
      onopen = null;
      onclose = null;
      onerror = null;
      onmessage = null;
      onHandlerMap.onopen = null;
      onHandlerMap.onclose = null;
      onHandlerMap.onerror = null;
      onHandlerMap.onmessage = null;
      readyState = connectOnCreate ? WS_OPEN : WS_CONNECTING;
    },
  };

  // Simulate delayed connection
  if (connectDelay > 0) {
    setTimeout(() => {
      readyState = WS_OPEN;
      ws.simulateOpen();
    }, connectDelay);
  }

  return ws;
}

/**
 * Vitest spy for the global WebSocket constructor.
 *
 * Usage:
 * ```ts
 * const mockWs = createMockWebSocket();
 * mockWebSocketConstructor.mockReturnValue(mockWs);
 * // Code under test does: new WebSocket("ws://...")
 * ```
 */
export const mockWebSocketConstructor = vi.fn(
  (url: string, _protocols?: string | string[]) => {
    return createMockWebSocket({ url });
  },
);
