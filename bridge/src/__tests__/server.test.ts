/**
 * Unit tests for the WebSocket server.
 *
 * Uses a real Bun.serve server with test WebSocket clients to exercise:
 * - request/response correlation by id
 * - BROWSER_NOT_CONNECTED rejection
 * - pending-request rejection on disconnect
 * - concurrent requests
 * - onResponse subscriptions
 * - start/stop lifecycle
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { onResponse, send, start, stop } from "../infrastructure/ws-server.js";

// ── Helpers ────────────────────────────────────────────────────────────────

let currentServer: ReturnType<typeof start> | null = null;

/**
 * Start a fresh server on a dynamic (OS-assigned) port.
 * Stores the server for cleanup and returns the port.
 */
async function startOnDynamicPort(): Promise<number> {
	stop();
	// Use port 0 so the OS picks a free port
	currentServer = await start(0);
	return currentServer.port;
}

/**
 * Connect a test WebSocket client to the server.
 * Resolves once the connection is open.
 */
function connectClient(port: number): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://localhost:${port}`);
		ws.onopen = () => resolve(ws);
		ws.onerror = (e) =>
			reject(new Error(`WebSocket connection failed: ${e.message}`));
		setTimeout(() => reject(new Error("WebSocket connection timed out")), 3000);
	});
}

/** Small sleep helper. */
function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// ═══════════════════════════════════════════════════════════════════════════
// BROWSER_NOT_CONNECTED — immediate rejection without a client
// ═══════════════════════════════════════════════════════════════════════════

describe("send() — no browser connected", () => {
	beforeEach(async () => {
		await startOnDynamicPort();
	});

	afterEach(() => {
		stop();
	});

	test("rejects with BROWSER_NOT_CONNECTED when no client is connected", async () => {
		await expect(
			send({
				id: "no-client",
				action: "navigate",
				params: { url: "https://example.com" },
			}),
		).rejects.toMatchObject({ code: "BROWSER_NOT_CONNECTED" });
	});

	test("error message is descriptive", async () => {
		try {
			await send({
				id: "no-client-2",
				action: "click",
				params: { selector: "#btn" },
			});
			expect.unreachable("Expected promise to reject");
		} catch (err: any) {
			expect(err.code).toBe("BROWSER_NOT_CONNECTED");
			expect(err.message).toContain("No browser extension is connected");
			expect(err.suggestion).toBeDefined();
			expect(err.suggestion).toContain("installed and running");
		}
	});

	test("all actions are rejected identically without a client", async () => {
		const actions = [
			{ action: "navigate" as const, params: { url: "https://example.com" } },
			{ action: "click" as const, params: { selector: "#x" } },
			{
				action: "type" as const,
				params: { selector: "input", text: "a" },
			},
			{ action: "screenshot" as const, params: {} },
			{ action: "read" as const, params: {} },
			{ action: "exec" as const, params: { code: "1+1" } },
		];

		for (const { action, params } of actions) {
			await expect(
				send({ id: crypto.randomUUID(), action, params } as any),
			).rejects.toMatchObject({ code: "BROWSER_NOT_CONNECTED" });
		}
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Request / Response correlation
// ═══════════════════════════════════════════════════════════════════════════

describe("send() — request/response correlation", () => {
	let port: number;

	beforeEach(async () => {
		port = await startOnDynamicPort();
	});

	afterEach(() => {
		stop();
	});

	test("resolves with the matching response by id", async () => {
		const ws = await connectClient(port);

		ws.onmessage = (event) => {
			const req = JSON.parse(event.data as string);
			ws.send(
				JSON.stringify({
					id: req.id,
					result: { url: "https://example.com", title: "Example Domain" },
				}),
			);
		};

		const response = await send({
			id: "echo-1",
			action: "navigate",
			params: { url: "https://example.com" },
		});

		expect(response.id).toBe("echo-1");
		expect(response.result).toEqual({
			url: "https://example.com",
			title: "Example Domain",
		});
		expect(response.error).toBeUndefined();

		ws.close();
	});

	test("response id is echoed exactly as sent", async () => {
		const ws = await connectClient(port);

		ws.onmessage = (event) => {
			const req = JSON.parse(event.data as string);
			ws.send(JSON.stringify({ id: req.id, result: req }));
		};

		const response = await send({
			id: "exact-id-match",
			action: "click",
			params: { selector: ".btn" },
		});

		expect(response.id).toBe("exact-id-match");
		ws.close();
	});

	test("ignores messages with non-matching ids", async () => {
		const ws = await connectClient(port);

		ws.onmessage = (event) => {
			const req = JSON.parse(event.data as string);

			// Send a message with a different id first (should be ignored by correlation)
			ws.send(JSON.stringify({ id: "wrong-id", result: "bogus" }));

			// Small delay, then send the real response
			setTimeout(() => {
				ws.send(
					JSON.stringify({
						id: req.id,
						result: { url: "https://real.com", title: "Real" },
					}),
				);
			}, 100);
		};

		const response = await send({
			id: "correct-id",
			action: "navigate",
			params: { url: "https://example.com" },
		});

		expect(response.id).toBe("correct-id");
		expect(response.result).toEqual({
			url: "https://real.com",
			title: "Real",
		});

		ws.close();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Disconnect rejection
// ═══════════════════════════════════════════════════════════════════════════

describe("send() — disconnection rejects pending", () => {
	let port: number;

	beforeEach(async () => {
		port = await startOnDynamicPort();
	});

	afterEach(() => {
		stop();
	});

	test("pending requests reject on client disconnect", async () => {
		const ws = await connectClient(port);

		// Client never responds — silent
		ws.onmessage = () => {};

		const promise = send({
			id: "will-drop",
			action: "navigate",
			params: { url: "https://example.com" },
		});

		// Small delay so the request is registered in pendingRequests
		await sleep(50);

		// Close the last connection — should trigger rejectAllPending
		ws.close();

		await expect(promise).rejects.toMatchObject({
			code: "BROWSER_NOT_CONNECTED",
		});
	});

	test("remaining connections prevent rejection", async () => {
		// Connect two clients
		const ws1 = await connectClient(port);
		const ws2 = await connectClient(port);

		// Close the first so send() routes to the remaining one
		ws1.close();
		await sleep(50);

		// The remaining client will echo responses
		ws2.onmessage = (event) => {
			const req = JSON.parse(event.data as string);
			ws2.send(JSON.stringify({ id: req.id, result: { ok: true } }));
		};

		// send() should use ws2 (the only remaining connection)
		const response = await send({
			id: "two-clients",
			action: "read",
			params: {},
		});

		expect(response.id).toBe("two-clients");
		expect(response.result).toEqual({ ok: true });

		ws2.close();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Concurrent requests
// ═══════════════════════════════════════════════════════════════════════════

describe("send() — concurrent requests", () => {
	let port: number;

	beforeEach(async () => {
		port = await startOnDynamicPort();
	});

	afterEach(() => {
		stop();
	});

	test("each request resolves with its own matching response", async () => {
		const ws = await connectClient(port);

		ws.onmessage = (event) => {
			const req = JSON.parse(event.data as string);
			ws.send(JSON.stringify({ id: req.id, result: { echo: req.id } }));
		};

		const [r1, r2, r3] = await Promise.all([
			send({ id: "a", action: "navigate", params: { url: "https://a.com" } }),
			send({ id: "b", action: "navigate", params: { url: "https://b.com" } }),
			send({ id: "c", action: "click", params: { selector: ".c" } }),
		]);

		expect(r1.id).toBe("a");
		expect(r2.id).toBe("b");
		expect(r3.id).toBe("c");

		expect(r1.result).toEqual({ echo: "a" });
		expect(r2.result).toEqual({ echo: "b" });
		expect(r3.result).toEqual({ echo: "c" });

		ws.close();
	});

	test("responses arriving out of order are still correlated", async () => {
		const ws = await connectClient(port);

		ws.onmessage = (event) => {
			const req = JSON.parse(event.data as string);

			// Respond to "slow" after a delay, "fast" immediately
			if (req.id === "slow") {
				setTimeout(() => {
					ws.send(JSON.stringify({ id: req.id, result: { name: "slow" } }));
				}, 200);
			} else {
				ws.send(JSON.stringify({ id: req.id, result: { name: "fast" } }));
			}
		};

		const slowPromise = send({
			id: "slow",
			action: "read",
			params: {},
		});

		// Small delay to ensure "slow" is sent first
		await sleep(50);

		const fastPromise = send({
			id: "fast",
			action: "read",
			params: {},
		});

		// "fast" should resolve before "slow" because it responds immediately
		const fast = await fastPromise;
		expect(fast.id).toBe("fast");
		expect(fast.result).toEqual({ name: "fast" });

		const slow = await slowPromise;
		expect(slow.id).toBe("slow");
		expect(slow.result).toEqual({ name: "slow" });

		ws.close();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// onResponse subscriptions
// ═══════════════════════════════════════════════════════════════════════════

describe("onResponse() — response subscriptions", () => {
	let port: number;

	beforeEach(async () => {
		port = await startOnDynamicPort();
	});

	afterEach(() => {
		stop();
	});

	test("notifies subscribers of correlated responses", async () => {
		const ws = await connectClient(port);
		const received: unknown[] = [];

		const unsubscribe = onResponse((response) => {
			received.push(response);
		});

		ws.onmessage = (event) => {
			const req = JSON.parse(event.data as string);
			ws.send(JSON.stringify({ id: req.id, result: { ok: true } }));
		};

		await send({ id: "sub-1", action: "read", params: {} });
		await send({ id: "sub-2", action: "read", params: {} });

		expect(received).toHaveLength(2);
		expect((received[0] as any).id).toBe("sub-1");
		expect((received[1] as any).id).toBe("sub-2");

		unsubscribe();
		ws.close();
	});

	test("unsubscribe stops notifications", async () => {
		const ws = await connectClient(port);
		const received: unknown[] = [];

		const unsubscribe = onResponse((r) => received.push(r));

		ws.onmessage = (event) => {
			const req = JSON.parse(event.data as string);
			ws.send(JSON.stringify({ id: req.id, result: { ok: true } }));
		};

		await send({ id: "s1", action: "read", params: {} });
		expect(received).toHaveLength(1);

		unsubscribe();

		await send({ id: "s2", action: "read", params: {} });
		// Should still be 1 — unsubscribed
		expect(received).toHaveLength(1);

		ws.close();
	});

	test("multiple subscribers can listen simultaneously", async () => {
		const ws = await connectClient(port);
		const sub1: unknown[] = [];
		const sub2: unknown[] = [];

		const unsub1 = onResponse((r) => sub1.push(r));
		const unsub2 = onResponse((r) => sub2.push(r));

		ws.onmessage = (event) => {
			const req = JSON.parse(event.data as string);
			ws.send(JSON.stringify({ id: req.id, result: { shared: true } }));
		};

		await send({ id: "shared", action: "read", params: {} });

		expect(sub1).toHaveLength(1);
		expect(sub2).toHaveLength(1);
		expect((sub1[0] as any).id).toBe("shared");
		expect((sub2[0] as any).id).toBe("shared");

		unsub1();
		unsub2();
		ws.close();
	});

	test("handler errors do not crash the server or break other handlers", async () => {
		const ws = await connectClient(port);
		const goodCalls: unknown[] = [];

		// This handler will throw
		const unsubBad = onResponse(() => {
			throw new Error("Intentional handler error");
		});

		// This handler should still work
		const unsubGood = onResponse((r) => goodCalls.push(r));

		ws.onmessage = (event) => {
			const req = JSON.parse(event.data as string);
			ws.send(JSON.stringify({ id: req.id, result: { resilient: true } }));
		};

		await send({ id: "resilient", action: "read", params: {} });

		// The good handler should still have been called
		expect(goodCalls).toHaveLength(1);
		expect((goodCalls[0] as any).id).toBe("resilient");

		unsubBad();
		unsubGood();
		ws.close();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// start / stop lifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe("start() / stop() lifecycle", () => {
	afterEach(() => {
		stop();
	});

	test("start() returns a server instance with the given port", async () => {
		const srv = await start(0);
		expect(srv).toBeDefined();
		expect(srv.port).toBeGreaterThan(0);
	});

	test("start() defaults to port 9242 when no env or override", async () => {
		stop();
		const prevEnv = process.env.AGENT_BROWSER_PORT;
		delete process.env.AGENT_BROWSER_PORT;

		const srv = await start();
		expect(srv.port).toBe(9242);

		if (prevEnv !== undefined) process.env.AGENT_BROWSER_PORT = prevEnv;
	});

	test("start() respects AGENT_BROWSER_PORT env variable", async () => {
		stop();
		process.env.AGENT_BROWSER_PORT = "19999";
		const srv = await start();
		expect(srv.port).toBe(19999);

		delete process.env.AGENT_BROWSER_PORT;
	});

	test("start() overrides env with explicit port", async () => {
		stop();
		process.env.AGENT_BROWSER_PORT = "19999";
		const srv = await start(0);
		expect(srv.port).toBeGreaterThan(0); // explicit 0 wins
		expect(srv.port).not.toBe(19999);

		delete process.env.AGENT_BROWSER_PORT;
	});

	test("start() is idempotent — stops previous before starting new", async () => {
		const s1 = await start(0);
		const s2 = await start(0);
		// Both calls should succeed; the second replaces the first
		expect(s2.port).toBeGreaterThan(0);
		// Different port because we used port 0 both times (OS assigns fresh)
		expect(s2).not.toBe(s1);
	});

	test("stop() clears connections so send() rejects with BROWSER_NOT_CONNECTED", async () => {
		const srv = await start(0);
		const port = srv.port;
		const ws = await connectClient(port);

		// Send a request but don't respond yet
		ws.onmessage = () => {};
		const promise = send({
			id: "stop-test",
			action: "read",
			params: {},
		});

		// Stop the server — should reject all pending
		stop();

		await expect(promise).rejects.toMatchObject({
			code: "BROWSER_NOT_CONNECTED",
		});

		// After stop, new send() calls should reject (no active server)
		await start(0);
		// No client connected to new server
		await expect(
			send({ id: "after-stop", action: "read", params: {} }),
		).rejects.toMatchObject({ code: "BROWSER_NOT_CONNECTED" });
	});

	test("stop() clears response subscribers", async () => {
		const srv = await start(0);
		const port = srv.port;
		const ws = await connectClient(port);

		const calls: unknown[] = [];
		onResponse((r) => calls.push(r));

		// Confirm subscription works
		ws.onmessage = (event) => {
			const req = JSON.parse(event.data as string);
			ws.send(JSON.stringify({ id: req.id, result: { ok: true } }));
		};
		await send({ id: "pre-stop", action: "read", params: {} });
		expect(calls).toHaveLength(1);

		stop();

		// After stop, subscription list should be cleared
		// Start a new server to verify
		const srv2 = await start(0);
		const ws2 = await connectClient(srv2.port);

		ws2.onmessage = (event) => {
			const req = JSON.parse(event.data as string);
			ws2.send(JSON.stringify({ id: req.id, result: { ok: true } }));
		};

		await send({ id: "post-stop", action: "read", params: {} });
		// Old handler was cleared by stop(), so no new call
		expect(calls).toHaveLength(1);

		ws2.close();
	});

	test("double stop() is safe (idempotent)", async () => {
		await start(0);
		stop();
		stop(); // should not throw
		// No assertion needed — just shouldn't crash
	});
});
