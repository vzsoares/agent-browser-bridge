/**
 * Bridge authentication: hello token, Origin pinning, the /client route,
 * extension replacement, bind address and token files.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import {
	DEFAULT_EXTENSION_ID,
	loadOrCreateTokenFile,
	parseHello,
	resolveBridgeOptions,
	tokensEqual,
} from "../infrastructure/auth.js";
import { getClientSocket } from "../infrastructure/ws-failover.js";
import { onResponse, send, start, stop } from "../infrastructure/ws-server.js";
import {
	closeCode,
	connectExtension,
	EXTENSION_ORIGIN,
	openSocket,
	sleep,
	startTestBridge,
	TEST_PAIR_TOKEN,
	tempTokenFiles,
} from "./bridge-test-helpers.js";

afterEach(() => {
	stop();
});

/** Status of a raw WebSocket upgrade request (101 when accepted). */
function upgradeStatus(
	port: number,
	path: string,
	origin: string | null,
): Promise<number> {
	return new Promise((resolve, reject) => {
		const lines = [
			`GET ${path} HTTP/1.1`,
			`Host: 127.0.0.1:${port}`,
			"Connection: Upgrade",
			"Upgrade: websocket",
			"Sec-WebSocket-Version: 13",
			`Sec-WebSocket-Key: ${Buffer.from("the sample nonce").toString("base64")}`,
		];
		if (origin) lines.push(`Origin: ${origin}`);
		const socket = connect(port, "127.0.0.1", () => {
			socket.write(`${lines.join("\r\n")}\r\n\r\n`);
		});
		socket.once("data", (chunk) => {
			socket.destroy();
			const m = chunk.toString().match(/^HTTP\/1\.1 (\d{3})/);
			resolve(m?.[1] ? Number(m[1]) : 0);
		});
		socket.on("error", reject);
	});
}

function pendingRead(id: string) {
	return send({ id, action: "read", params: {} });
}

// ── Token ──────────────────────────────────────────────────────────────────

describe("hello token on /", () => {
	test("no hello within 2 s closes with 4401", async () => {
		const { port } = await startTestBridge();
		const ws = await openSocket(port);
		expect(await closeCode(ws)).toBe(4401);
	});

	test("wrong token closes with 4401", async () => {
		const { port } = await startTestBridge();
		const ws = await openSocket(port);
		ws.send(JSON.stringify({ type: "hello", token: "b".repeat(64) }));
		expect(await closeCode(ws)).toBe(4401);
	});

	test("token one char short closes with 4401", async () => {
		const { port } = await startTestBridge();
		const ws = await openSocket(port);
		ws.send(
			JSON.stringify({ type: "hello", token: TEST_PAIR_TOKEN.slice(0, -1) }),
		);
		expect(await closeCode(ws)).toBe(4401);
	});

	test("a first frame that is not a hello closes with 4401", async () => {
		const { port } = await startTestBridge();
		const ws = await openSocket(port);
		ws.send(JSON.stringify({ id: "x", result: {} }));
		expect(await closeCode(ws)).toBe(4401);
	});

	test("hello after 2 s is too late", async () => {
		const { port } = await startTestBridge();
		const ws = await openSocket(port);
		const code = closeCode(ws);
		await sleep(2100);
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: "hello", token: TEST_PAIR_TOKEN }));
		}
		expect(await code).toBe(4401);
	});

	test("nothing is relayed to an unauthenticated socket", async () => {
		const { port } = await startTestBridge();
		const ws = await openSocket(port);
		const received: string[] = [];
		ws.onmessage = (e) => received.push(String(e.data));
		await expect(pendingRead("unauth")).rejects.toMatchObject({
			code: "BROWSER_NOT_CONNECTED",
		});
		expect(received).toHaveLength(0);
		ws.close();
	});

	test("right token relays requests and the hello is never forwarded", async () => {
		const { port } = await startTestBridge();
		const seen: unknown[] = [];
		onResponse((r) => seen.push(r));
		const ws = await connectExtension(port);
		ws.onmessage = (e) => {
			const req = JSON.parse(String(e.data));
			ws.send(JSON.stringify({ id: req.id, result: { ok: true } }));
		};
		const res = await pendingRead("authed");
		expect(res.result).toEqual({ ok: true });
		expect(seen).toEqual([{ id: "authed", result: { ok: true } }]);
		ws.close();
	});
});

// ── Origin ─────────────────────────────────────────────────────────────────

describe("Origin pinning", () => {
	test.each([
		["wrong extension", "chrome-extension://abcdefghijklmnopabcdefghijklmnop"],
		["http page", "http://localhost:3000"],
		["missing", null],
	])("/ refuses %s Origin with 403", async (_label, origin) => {
		const { port } = await startTestBridge();
		expect(await upgradeStatus(port, "/", origin)).toBe(403);
	});

	test("/ upgrades for the pinned extension Origin", async () => {
		const { port } = await startTestBridge();
		expect(await upgradeStatus(port, "/", EXTENSION_ORIGIN)).toBe(101);
	});

	test("AGENT_BROWSER_EXTENSION_ID overrides the pinned id", () => {
		expect(
			resolveBridgeOptions({}, { AGENT_BROWSER_EXTENSION_ID: "x" }).extensionId,
		).toBe("x");
		expect(resolveBridgeOptions({}, {}).extensionId).toBe(DEFAULT_EXTENSION_ID);
	});

	test("/client refuses any Origin with 403", async () => {
		const { port } = await startTestBridge({ clientRoute: true });
		expect(await upgradeStatus(port, "/client", EXTENSION_ORIGIN)).toBe(403);
		expect(await upgradeStatus(port, "/client", "http://localhost")).toBe(403);
	});

	test("the pinned id matches the manifest key", async () => {
		const manifest: unknown = JSON.parse(
			readFileSync(
				join(import.meta.dir, "../../../chrome-extension/manifest.json"),
				"utf8",
			),
		);
		const key =
			typeof manifest === "object" &&
			manifest !== null &&
			"key" in manifest &&
			typeof manifest.key === "string"
				? manifest.key
				: "";
		const der = Buffer.from(key, "base64");
		const hex = new Bun.CryptoHasher("sha256")
			.update(der)
			.digest("hex")
			.slice(0, 32);
		const id = [...hex]
			.map((c) => String.fromCharCode(97 + Number.parseInt(c, 16)))
			.join("");
		expect(id).toBe(DEFAULT_EXTENSION_ID);
	});
});

// ── /client route ──────────────────────────────────────────────────────────

describe("/client route", () => {
	test("AGENT_BROWSER_CLIENT=off removes the route", async () => {
		expect(
			resolveBridgeOptions({}, { AGENT_BROWSER_CLIENT: "off" }).clientRoute,
		).toBe(false);
		const { port } = await startTestBridge({ clientRoute: false });
		expect(await upgradeStatus(port, "/client", null)).toBe(404);
	});

	test("with the route off, start() does not try client mode", async () => {
		const files = tempTokenFiles();
		const owner = Bun.spawn(
			["bun", join(import.meta.dir, "../../../index.ts")],
			{
				env: {
					...process.env,
					HOME: files.dir,
					AGENT_BROWSER_PORT: "0",
					AGENT_BROWSER_BRIDGE_LOG_LEVEL: "info",
				},
				stderr: "pipe",
				stdout: "pipe",
			},
		);
		try {
			// The child owner writes its client token under $HOME.
			const clientTokenFile = join(
				files.dir,
				".config/agent-browser-bridge/client.token",
			);
			const port = await childPort(owner);

			await expect(
				start({
					port,
					clientRoute: false,
					pairTokenFile: files.pairTokenFile,
					clientTokenFile,
				}),
			).rejects.toThrow(/in use/);
			expect(getClientSocket()).toBeNull();
			stop();

			// Positive control: with the route on, the same start joins as client.
			await start({
				port,
				clientRoute: true,
				pairTokenFile: files.pairTokenFile,
				clientTokenFile,
			});
			expect(getClientSocket()).not.toBeNull();
		} finally {
			stop();
			owner.kill();
			await owner.exited;
		}
	});

	test("the client token rotates per owner start; the old one gets 4401", async () => {
		const files = tempTokenFiles();
		const opts = {
			port: 0,
			clientRoute: true,
			pairTokenFile: files.pairTokenFile,
			clientTokenFile: files.clientTokenFile,
		};
		await start(opts);
		const oldToken = readFileSync(files.clientTokenFile, "utf8").trim();
		stop();

		const { port } = await start(opts);
		const newToken = readFileSync(files.clientTokenFile, "utf8").trim();
		expect(newToken).not.toBe(oldToken);
		expect(newToken).toMatch(/^[0-9a-f]{64}$/);

		const stale = await openSocket(port, "/client", null);
		stale.send(JSON.stringify({ type: "hello", token: oldToken }));
		expect(await closeCode(stale)).toBe(4401);

		const fresh = await openSocket(port, "/client", null);
		const welcome = new Promise<string>((resolve) => {
			fresh.onmessage = (e) => resolve(String(e.data));
		});
		fresh.send(JSON.stringify({ type: "hello", token: newToken }));
		expect(JSON.parse(await welcome)).toMatchObject({ type: "welcome" });
		fresh.close();
	});
});

/** Read the port a child `index.ts` owner logs on stderr. */
async function childPort(proc: Bun.Subprocess<"ignore", "pipe", "pipe">) {
	const reader = proc.stderr.getReader();
	const decoder = new TextDecoder();
	let buf = "";
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		const { value, done } = await reader.read();
		if (done) break;
		buf += decoder.decode(value);
		const m = buf.match(/Ready on port (\d+)/);
		if (m?.[1]) {
			reader.releaseLock();
			return Number(m[1]);
		}
	}
	throw new Error(`owner did not start: ${buf}`);
}

// ── Bind ───────────────────────────────────────────────────────────────────

describe("bind address", () => {
	test("defaults to 127.0.0.1", () => {
		expect(resolveBridgeOptions({}, {}).host).toBe("127.0.0.1");
	});

	test("AGENT_BROWSER_HOST overrides it", () => {
		expect(
			resolveBridgeOptions({}, { AGENT_BROWSER_HOST: "0.0.0.0" }).host,
		).toBe("0.0.0.0");
	});
});

// ── Replacement ────────────────────────────────────────────────────────────

describe("one extension at a time", () => {
	test("a newer extension replaces the older; its in-flight request fails with CONNECTION_RESET", async () => {
		const { port } = await startTestBridge();
		const first = await connectExtension(port);
		first.onmessage = () => {};
		const firstClosed = closeCode(first);

		const inFlight = pendingRead("in-flight").then(
			() => null,
			(err: unknown) => err,
		);
		await sleep(50);

		const second = await connectExtension(port);
		expect(await inFlight).toMatchObject({ code: "CONNECTION_RESET" });
		expect(await firstClosed).toBe(4000);

		second.onmessage = (e) => {
			const req = JSON.parse(String(e.data));
			second.send(JSON.stringify({ id: req.id, result: { via: "second" } }));
		};
		const res = await pendingRead("after");
		expect(res.result).toEqual({ via: "second" });
		second.close();
	});
});

// ── Token files and helpers ────────────────────────────────────────────────

describe("token files", () => {
	test("the pairing token is created 0600 with 32 random bytes hex", () => {
		const { dir } = tempTokenFiles();
		const path = join(dir, "nested/pair.token");
		const token = loadOrCreateTokenFile(path);
		expect(token).toMatch(/^[0-9a-f]{64}$/);
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(loadOrCreateTokenFile(path)).toBe(token);
	});

	test("the client token file is 0600", async () => {
		const { files } = await startTestBridge({ clientRoute: true });
		expect(statSync(files.clientTokenFile).mode & 0o777).toBe(0o600);
	});

	test("an empty pairing token file is refused", () => {
		const { dir } = tempTokenFiles();
		const path = join(dir, "empty.token");
		writeFileSync(path, "\n");
		expect(() => loadOrCreateTokenFile(path)).toThrow();
	});

	test("AGENT_BROWSER_PAIR_TOKEN_FILE sets the pairing token path", () => {
		expect(
			resolveBridgeOptions({}, { AGENT_BROWSER_PAIR_TOKEN_FILE: "/run/abb/t" })
				.pairTokenFile,
		).toBe("/run/abb/t");
	});

	test("tokensEqual and parseHello", () => {
		expect(tokensEqual("abc", "abc")).toBe(true);
		expect(tokensEqual("abc", "abd")).toBe(false);
		expect(tokensEqual("abc", "ab")).toBe(false);
		expect(parseHello('{"type":"hello","token":"t"}')).toBe("t");
		expect(parseHello('{"type":"hello"}')).toBeNull();
		expect(parseHello("not json")).toBeNull();
	});
});
