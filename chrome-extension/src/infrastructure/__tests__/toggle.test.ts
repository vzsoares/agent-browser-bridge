/**
 * Toggle and pairing wiring in the service worker: off closes the socket
 * with 1000 and stops reconnecting; on (or a new token) reconnects at once.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createMockWebSocket } from "../../__tests__/mocks/websocket.js";
import { init } from "../background-service.js";
import { PAIR_TOKEN_KEY, STORAGE_KEY } from "../chrome-storage.js";

type ChangeListener = (
	changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
	area: string,
) => void;

const listeners: ChangeListener[] = [];
const sockets: ReturnType<typeof createMockWebSocket>[] = [];
let store: Record<string, unknown> = {};

function emitChange(key: string, newValue: unknown): void {
	store[key] = newValue;
	for (const l of listeners) l({ [key]: { newValue } }, "local");
}

function listenerStub() {
	return { addListener: vi.fn(), removeListener: vi.fn() };
}

beforeEach(() => {
	vi.useFakeTimers();
	listeners.length = 0;
	sockets.length = 0;
	store = { [PAIR_TOKEN_KEY]: "a".repeat(64) };

	const ws = vi.fn((url: string) => {
		const s = createMockWebSocket({ url, connectOnCreate: false });
		sockets.push(s);
		return s;
	});
	Object.assign(ws, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
	vi.stubGlobal("WebSocket", ws);

	vi.stubGlobal("chrome", {
		storage: {
			local: {
				get: vi.fn(async (key: string) => ({ [key]: store[key] })),
				set: vi.fn(async (items: Record<string, unknown>) => {
					Object.assign(store, items);
				}),
			},
			onChanged: {
				addListener: (l: ChangeListener) => listeners.push(l),
				removeListener: vi.fn(),
			},
		},
		action: {
			setBadgeText: vi.fn(async () => {}),
			setBadgeBackgroundColor: vi.fn(async () => {}),
			setTitle: vi.fn(async () => {}),
		},
		tabs: {
			query: vi.fn(async () => []),
			onActivated: listenerStub(),
			onRemoved: listenerStub(),
		},
		runtime: { onInstalled: listenerStub(), onMessage: listenerStub() },
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("bridge toggle", () => {
	test("off closes with 1000 and stops reconnecting; on reconnects at once", async () => {
		const api = await init(logger);
		api.connect();
		expect(sockets).toHaveLength(1);
		sockets[0]?.simulateOpen();

		emitChange(STORAGE_KEY, { enabled: false });
		expect(sockets[0]?.close).toHaveBeenCalledWith(1000, expect.any(String));
		await vi.advanceTimersByTimeAsync(30_000);
		expect(sockets).toHaveLength(1);

		emitChange(STORAGE_KEY, { enabled: true });
		expect(sockets).toHaveLength(2);
	});

	test("starts without connecting when stored as off", async () => {
		store[STORAGE_KEY] = { enabled: false };
		const api = await init(logger);
		api.connect();
		expect(sockets).toHaveLength(0);
	});

	test("a newly saved pairing token reconnects", async () => {
		delete store[PAIR_TOKEN_KEY];
		const api = await init(logger);
		api.connect();
		expect(sockets).toHaveLength(0);

		emitChange(PAIR_TOKEN_KEY, "b".repeat(64));
		expect(sockets).toHaveLength(1);
		sockets[0]?.simulateOpen();
		expect(sockets[0]?.sent[0]?.data).toBe(
			JSON.stringify({ type: "hello", token: "b".repeat(64) }),
		);
	});
});
