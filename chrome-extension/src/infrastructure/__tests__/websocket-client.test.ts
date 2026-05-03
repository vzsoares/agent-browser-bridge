/**
 * WebSocket client tests — reconnect, keep-alive, send, status, and lifecycle.
 *
 * Uses the MockWebSocket from T004 to simulate WebSocket behavior
 * without real network calls. All tests are deterministic.
 *
 * @module infrastructure/__tests__/websocket-client.test
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ConnectionStatus } from "../chrome-runtime.js";
import { WebSocketClient } from "../websocket-client.js";
import { createMockWebSocket } from "../../__tests__/mocks/websocket.js";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Minimal logger that captures output for assertions. */
function createSpyLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/**
 * Create a mock WebSocket constructor that is also a Vitest spy.
 *
 * Returns a tuple of [spy function, instance getter]. The spy function
 * can be used as a constructor (`new WebSocket(url)`) and returns a
 * mock WebSocket instance with full getter/setter support.
 */
function createMockWebSocketSpy() {
  let instance: ReturnType<typeof createMockWebSocket> | null = null;

  // Create the mock instance eagerly so connectOnCreate sets readyState=OPEN
  const mock = createMockWebSocket({ url: "ws://localhost:9242", connectOnCreate: true });

  // Spy function that acts as a constructor and also tracks calls
  const spy = vi.fn(function (this: any, url: string) {
    instance = createMockWebSocket({ url, connectOnCreate: true });
    return instance as any;
  });

  // Add static WebSocket constants
  (spy as any).CONNECTING = 0;
  (spy as any).OPEN = 1;
  (spy as any).CLOSING = 2;
  (spy as any).CLOSED = 3;

  return {
    spy,
    getInstance: () => instance!,
  };
}

let wsSpy: ReturnType<typeof vi.fn>;
let getWsInstance: () => ReturnType<typeof createMockWebSocket>;

beforeEach(() => {
  const { spy, getInstance } = createMockWebSocketSpy();
  wsSpy = spy;
  getWsInstance = getInstance;
  vi.stubGlobal("WebSocket", spy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Simulate a successful WebSocket open (fires onopen handler). */
function simulateOpen() {
  getWsInstance().simulateOpen();
}

// ── WebSocket connection tests ───────────────────────────────────────────

describe("WebSocketClient — connection lifecycle", () => {
  test("connect() creates a WebSocket with the correct URL", () => {
    const logger = createSpyLogger();
    const client = new WebSocketClient({
      port: 9242,
      logger,
      onMessage: vi.fn(),
    });

    client.connect();

    expect(wsSpy).toHaveBeenCalledWith("ws://localhost:9242");
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Connecting to ws://localhost:9242"),
    );
  });

  test("connect() sets status to 'connecting' then 'connected' on open", () => {
    const logger = createSpyLogger();
    const onStatusChange = vi.fn();
    const client = new WebSocketClient({
      port: 9242,
      logger,
      onMessage: vi.fn(),
      onStatusChange,
    });

    client.connect();

    // onStatusChange should have been called with "connecting" during connect()
    expect(onStatusChange).toHaveBeenCalledWith("connecting");

    // Simulate the WebSocket open event
    simulateOpen();

    expect(onStatusChange).toHaveBeenCalledWith("connected");
    expect(logger.info).toHaveBeenCalledWith("WebSocket connected");
  });

  test("isOpen() returns true when connected and onopen fired", () => {
    const client = new WebSocketClient({
      port: 9242,
      logger: createSpyLogger(),
      onMessage: vi.fn(),
    });

    client.connect();
    simulateOpen(); // onopen sets readyState check state

    expect(client.isOpen()).toBe(true);
  });

  test("isOpen() returns false when not connected", () => {
    const client = new WebSocketClient({
      port: 9242,
      logger: createSpyLogger(),
      onMessage: vi.fn(),
    });

    // Don't connect — just check
    expect(client.isOpen()).toBe(false);
  });

  test("setPort() updates the port", () => {
    const client = new WebSocketClient({
      port: 9242,
      logger: createSpyLogger(),
      onMessage: vi.fn(),
    });

    expect(client.getPort()).toBe(9242);
    client.setPort(9999);
    expect(client.getPort()).toBe(9999);
  });
});

// ── WebSocket reconnect tests ────────────────────────────────────────────

describe("WebSocketClient — reconnect behavior", () => {
  test("auto-reconnects within 1 second after disconnect (code ≠ 1000)", async () => {
    vi.useFakeTimers();

    const logger = createSpyLogger();
    const onStatusChange = vi.fn();
    const client = new WebSocketClient({
      port: 9242,
      logger,
      onMessage: vi.fn(),
      onStatusChange,
    });

    client.connect();
    simulateOpen();

    // Reset spy for assertion on reconnect
    wsSpy.mockClear();

    // Simulate the close event with code 1006 (abnormal closure)
    getWsInstance().simulateClose(1006, "Connection lost");

    // The client should schedule a reconnect with 1000ms initial backoff
    await vi.advanceTimersByTimeAsync(1100);

    // WebSocket constructor should have been called again (reconnect attempt)
    expect(wsSpy).toHaveBeenCalledTimes(1);
    expect(wsSpy).toHaveBeenCalledWith("ws://localhost:9242");
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Reconnecting in 1000ms"),
    );
  });

  test("does NOT reconnect on close code 1000 (normal closure)", async () => {
    vi.useFakeTimers();

    const logger = createSpyLogger();
    const onStatusChange = vi.fn();
    const client = new WebSocketClient({
      port: 9242,
      logger,
      onMessage: vi.fn(),
      onStatusChange,
    });

    client.connect();
    simulateOpen();

    wsSpy.mockClear();

    // Simulate a normal close (code 1000)
    getWsInstance().simulateClose(1000, "Normal closure");

    // Advance time — no reconnect should fire
    await vi.advanceTimersByTimeAsync(2000);

    expect(wsSpy).not.toHaveBeenCalled();
    expect(onStatusChange).toHaveBeenCalledWith("disconnected");
  });

  test("exponential backoff increases on repeated failures", async () => {
    vi.useFakeTimers();

    const logger = createSpyLogger();
    const client = new WebSocketClient({
      port: 9242,
      logger,
      onMessage: vi.fn(),
    });

    client.connect();
    simulateOpen();

    // First close — attempt 1, delay 1000ms
    getWsInstance().simulateClose(1006, "Abnormal");

    await vi.advanceTimersByTimeAsync(1100);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Reconnecting in 1000ms (attempt 1)"),
    );

    // The reconnect creates a new WebSocket via the spy
    // Close the new one again — attempt 2, delay 2000ms
    logger.info.mockClear();
    getWsInstance().simulateClose(1006, "Abnormal again");

    await vi.advanceTimersByTimeAsync(2100);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Reconnecting in 2000ms (attempt 2)"),
    );
  });

  test("reconnect backoff capped at 30 seconds", async () => {
    vi.useFakeTimers();

    const logger = createSpyLogger();
    const client = new WebSocketClient({
      port: 9242,
      logger,
      onMessage: vi.fn(),
    });

    client.connect();
    simulateOpen();

    // Trigger 6 consecutive close-reconnect cycles WITHOUT simulating open
    // between them. This way the reconnectAttempt counter keeps incrementing
    // and the backoff grows: 1s, 2s, 4s, 8s, 16s, 30s (capped).

    // Cycle 1: close → reconnect in 1000ms (attempt 1)
    getWsInstance().simulateClose(1006, "Fail");
    await vi.advanceTimersByTimeAsync(1100);

    // Cycle 2: close the reconnected socket → reconnect in 2000ms (attempt 2)
    getWsInstance().simulateClose(1006, "Fail");
    await vi.advanceTimersByTimeAsync(2100);

    // Cycle 3: close → reconnect in 4000ms (attempt 3)
    getWsInstance().simulateClose(1006, "Fail");
    await vi.advanceTimersByTimeAsync(4100);

    // Cycle 4: close → reconnect in 8000ms (attempt 4)
    getWsInstance().simulateClose(1006, "Fail");
    await vi.advanceTimersByTimeAsync(8100);

    // Cycle 5: close → reconnect in 16000ms (attempt 5)
    getWsInstance().simulateClose(1006, "Fail");
    await vi.advanceTimersByTimeAsync(16100);

    // Cycle 6: close → reconnect should be capped at 30000ms (attempt 6)
    getWsInstance().simulateClose(1006, "Fail");
    await vi.advanceTimersByTimeAsync(30100);

    const logCalls = logger.info.mock.calls.filter((c: any[]) =>
      typeof c[0] === "string" && c[0].includes("Reconnecting"),
    );

    // Should see 6 reconnect attempts
    expect(logCalls.length).toBeGreaterThanOrEqual(6);

    // The last attempt should mention 30000ms (capped)
    const lastCall = logCalls[logCalls.length - 1]?.[0] as string | undefined;
    expect(lastCall).toBeDefined();
    expect(lastCall).toContain("30000ms");
  });

  test("reconnect attempt counter resets on successful connection", async () => {
    vi.useFakeTimers();

    const logger = createSpyLogger();
    const client = new WebSocketClient({
      port: 9242,
      logger,
      onMessage: vi.fn(),
    });

    client.connect();
    simulateOpen();
    getWsInstance().simulateClose(1006, "Fail");

    // Wait for first reconnect
    await vi.advanceTimersByTimeAsync(1100);

    // After reconnect, simulate a successful open
    simulateOpen();

    logger.info.mockClear();

    // Then close again — should start back at attempt 1 with 1000ms
    getWsInstance().simulateClose(1006, "Fail again");

    await vi.advanceTimersByTimeAsync(1100);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Reconnecting in 1000ms (attempt 1)"),
    );
  });

  test("disconnect() cancels any pending reconnect", async () => {
    vi.useFakeTimers();

    const logger = createSpyLogger();
    const client = new WebSocketClient({
      port: 9242,
      logger,
      onMessage: vi.fn(),
    });

    client.connect();
    simulateOpen();
    getWsInstance().simulateClose(1006, "Abnormal");

    // Disconnect before the reconnect timer fires
    client.disconnect();

    wsSpy.mockClear();

    // Advance past the reconnect delay
    await vi.advanceTimersByTimeAsync(2000);

    // No reconnect should have happened
    expect(wsSpy).not.toHaveBeenCalled();
  });
});

// ── WebSocket send tests ─────────────────────────────────────────────────

describe("WebSocketClient — sending messages", () => {
  test("send() forwards data to the underlying WebSocket when open", () => {
    const client = new WebSocketClient({
      port: 9242,
      logger: createSpyLogger(),
      onMessage: vi.fn(),
    });

    client.connect();
    simulateOpen(); // Ensures onopen handler sets state

    client.send('{"type":"test"}');

    expect(getWsInstance().send).toHaveBeenCalledWith('{"type":"test"}');
    expect(getWsInstance().sent).toHaveLength(1);
  });

  test("send() is a no-op when not connected (no connect call)", () => {
    const logger = createSpyLogger();
    const client = new WebSocketClient({
      port: 9242,
      logger,
      onMessage: vi.fn(),
    });

    // Don't connect — just try to send
    client.send("should fail");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Cannot send"),
    );
  });

  test("send() is a no-op after disconnect()", () => {
    const logger = createSpyLogger();
    const client = new WebSocketClient({
      port: 9242,
      logger,
      onMessage: vi.fn(),
    });

    client.connect();
    simulateOpen();
    client.disconnect();
    client.send("after disconnect");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Cannot send"),
    );
  });

  test("send() is a no-op when WebSocket is in CLOSED state", () => {
    const logger = createSpyLogger();
    const client = new WebSocketClient({
      port: 9242,
      logger,
      onMessage: vi.fn(),
    });

    client.connect();
    simulateOpen();

    // Manually close via mock
    getWsInstance().readyState = 3; // CLOSED

    client.send("should not send");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Cannot send"),
    );
  });
});

// ── WebSocket receive tests ──────────────────────────────────────────────

describe("WebSocketClient — receiving messages", () => {
  test("forwards incoming string messages to onMessage callback", () => {
    const onMessage = vi.fn();
    const client = new WebSocketClient({
      port: 9242,
      logger: createSpyLogger(),
      onMessage,
    });

    client.connect();
    simulateOpen();
    getWsInstance().simulateMessage('{"id":"1","result":"ok"}');

    expect(onMessage).toHaveBeenCalledWith('{"id":"1","result":"ok"}');
  });

  test("passes string message data to onMessage", () => {
    const onMessage = vi.fn();
    const client = new WebSocketClient({
      port: 9242,
      logger: createSpyLogger(),
      onMessage,
    });

    client.connect();
    simulateOpen();
    getWsInstance().simulateMessage("plain string data");

    expect(onMessage).toHaveBeenCalledWith("plain string data");
  });

  test("catches errors in onMessage callback without crashing", () => {
    const logger = createSpyLogger();
    const onMessage = vi.fn(() => {
      throw new Error("callback exploded");
    });
    const client = new WebSocketClient({
      port: 9242,
      logger,
      onMessage,
    });

    client.connect();
    simulateOpen();
    getWsInstance().simulateMessage("some data");

    expect(onMessage).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Unhandled error in message callback"),
    );
  });
});

// ── WebSocket keep-alive tests ───────────────────────────────────────────

describe("WebSocketClient — keep-alive", () => {
  test("sends ping messages every 20 seconds while connected", async () => {
    vi.useFakeTimers();

    const client = new WebSocketClient({
      port: 9242,
      logger: createSpyLogger(),
      onMessage: vi.fn(),
    });

    client.connect();
    simulateOpen(); // Starts keep-alive

    // Clear calls from connect (none from send, but reset for clarity)
    getWsInstance().send.mockClear();

    // Advance 20 seconds — should trigger keep-alive ping
    await vi.advanceTimersByTimeAsync(20_000);
    expect(getWsInstance().send).toHaveBeenCalledWith(
      expect.stringContaining('"ping"'),
    );

    // Advance another 20 seconds — should trigger again
    await vi.advanceTimersByTimeAsync(20_000);
    expect(getWsInstance().send).toHaveBeenCalledTimes(2);
  });

  test("stops keep-alive after disconnect", async () => {
    vi.useFakeTimers();

    const client = new WebSocketClient({
      port: 9242,
      logger: createSpyLogger(),
      onMessage: vi.fn(),
    });

    client.connect();
    simulateOpen();

    // Disconnect the client
    client.disconnect();

    getWsInstance().send.mockClear();

    // Advance 25 seconds — no pings should be sent
    await vi.advanceTimersByTimeAsync(25_000);
    // After disconnect, this.ws is null, so getWsInstance() still references
    // the old mock. No pings should have been sent on it.
    expect(getWsInstance().send).not.toHaveBeenCalled();
  });

  test("stops keep-alive after close event", async () => {
    vi.useFakeTimers();

    const client = new WebSocketClient({
      port: 9242,
      logger: createSpyLogger(),
      onMessage: vi.fn(),
    });

    client.connect();
    simulateOpen();

    // Simulate WebSocket close
    getWsInstance().simulateClose(1006, "Lost");

    getWsInstance().send.mockClear();

    await vi.advanceTimersByTimeAsync(25_000);
    expect(getWsInstance().send).not.toHaveBeenCalled();
  });
});

// ── WebSocket status change tests ────────────────────────────────────────

describe("WebSocketClient — status changes", () => {
  test("calls onStatusChange with 'connecting' on connect()", () => {
    const onStatusChange = vi.fn();
    const client = new WebSocketClient({
      port: 9242,
      logger: createSpyLogger(),
      onMessage: vi.fn(),
      onStatusChange,
    });

    client.connect();

    // connect() calls updateStatus("connecting") before creating the socket
    expect(onStatusChange).toHaveBeenCalledWith("connecting");
  });

  test("calls onStatusChange with 'connected' on successful open", () => {
    const onStatusChange = vi.fn();
    const client = new WebSocketClient({
      port: 9242,
      logger: createSpyLogger(),
      onMessage: vi.fn(),
      onStatusChange,
    });

    client.connect();

    // Reset the spy after the initial "connecting" call
    const connectingCalls = onStatusChange.mock.calls.filter(
      (c: any[]) => c[0] === "connecting",
    ).length;

    simulateOpen();

    // Should now have "connected" call
    expect(onStatusChange).toHaveBeenCalledWith("connected");
    // And total calls = connectingCalls + 1 (for connected)
    expect(onStatusChange).toHaveBeenCalledTimes(connectingCalls + 1);
  });

  test("calls onStatusChange with 'disconnected' on close code 1000", () => {
    const onStatusChange = vi.fn();
    const client = new WebSocketClient({
      port: 9242,
      logger: createSpyLogger(),
      onMessage: vi.fn(),
      onStatusChange,
    });

    client.connect();
    simulateOpen();

    onStatusChange.mockClear();
    getWsInstance().simulateClose(1000, "Normal closure");

    expect(onStatusChange).toHaveBeenCalledWith("disconnected");
  });

  test("calls onStatusChange with 'connecting' during reconnect", async () => {
    vi.useFakeTimers();

    const onStatusChange = vi.fn();
    const client = new WebSocketClient({
      port: 9242,
      logger: createSpyLogger(),
      onMessage: vi.fn(),
      onStatusChange,
    });

    client.connect();
    simulateOpen();

    onStatusChange.mockClear();

    getWsInstance().simulateClose(1006, "Abnormal");

    // The reconnect schedule sets status to "connecting"
    expect(onStatusChange).toHaveBeenCalledWith("connecting");

    await vi.advanceTimersByTimeAsync(1100);

    // After reconnect, simulate open on the NEW instance
    simulateOpen();

    // Should have "connected" call
    expect(onStatusChange).toHaveBeenCalledWith("connected");
  });
});

// ── WebSocket lifecycle edge cases ───────────────────────────────────────

describe("WebSocketClient — lifecycle edge cases", () => {
  test("connect() cleans up stale socket before creating a new one", () => {
    const client = new WebSocketClient({
      port: 9242,
      logger: createSpyLogger(),
      onMessage: vi.fn(),
    });

    client.connect();
    simulateOpen();

    const firstInstance = getWsInstance();

    // Call connect() again — should clean up the old one
    client.connect();

    // The old instance's close should have been called (via cleanupStaleSocket)
    expect(firstInstance.close).toHaveBeenCalled();
  });

  test("handle WebSocket constructor throwing", () => {
    // Make WebSocket constructor throw
    const throwingSpy = vi.fn(() => {
      throw new Error("Network error");
    });
    (throwingSpy as any).CONNECTING = 0;
    (throwingSpy as any).OPEN = 1;
    (throwingSpy as any).CLOSING = 2;
    (throwingSpy as any).CLOSED = 3;
    vi.stubGlobal("WebSocket", throwingSpy);

    const logger = createSpyLogger();
    const client = new WebSocketClient({
      port: 9242,
      logger,
      onMessage: vi.fn(),
    });

    client.connect();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to create WebSocket"),
    );
  });

  test("multiple connect() calls are idempotent (no duplicate keep-alives)", async () => {
    vi.useFakeTimers();

    const client = new WebSocketClient({
      port: 9242,
      logger: createSpyLogger(),
      onMessage: vi.fn(),
    });

    client.connect();
    simulateOpen();
    client.connect(); // second call — cleans up and restarts
    simulateOpen();   // fire open on the new instance
    client.connect(); // third call
    simulateOpen();   // fire open on the new instance

    getWsInstance().send.mockClear();

    // Advance 20 seconds — should only fire one ping, not three
    await vi.advanceTimersByTimeAsync(20_000);

    // Should be exactly 1 ping call (one keepAliveTimer active)
    expect(getWsInstance().send).toHaveBeenCalledTimes(1);
  });

  test("handles error event without crashing", () => {
    const logger = createSpyLogger();
    const client = new WebSocketClient({
      port: 9242,
      logger,
      onMessage: vi.fn(),
    });

    client.connect();
    simulateOpen();

    // Simulate an error event — the handler logs the readyState
    expect(() => getWsInstance().simulateError()).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("WebSocket error"),
    );
  });

  test("connect() uses the port set by setPort()", () => {
    const logger = createSpyLogger();
    const client = new WebSocketClient({
      port: 9242,
      logger,
      onMessage: vi.fn(),
    });

    client.setPort(8080);
    client.connect();

    expect(wsSpy).toHaveBeenCalledWith("ws://localhost:8080");
  });
});
