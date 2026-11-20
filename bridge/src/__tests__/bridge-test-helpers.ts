/** Shared helpers for tests that run a real bridge server. */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_EXTENSION_ID } from "../infrastructure/auth.js";
import { type BridgeOptions, start } from "../infrastructure/ws-server.js";

export const EXTENSION_ORIGIN = `chrome-extension://${DEFAULT_EXTENSION_ID}`;
export const TEST_PAIR_TOKEN = "a".repeat(64);

/** Token files in a fresh temp dir, with the pairing token pre-written. */
export function tempTokenFiles(): {
	dir: string;
	pairTokenFile: string;
	clientTokenFile: string;
} {
	const dir = mkdtempSync(join(tmpdir(), "abb-test-"));
	const pairTokenFile = join(dir, "pair.token");
	writeFileSync(pairTokenFile, `${TEST_PAIR_TOKEN}\n`, { mode: 0o600 });
	return { dir, pairTokenFile, clientTokenFile: join(dir, "client.token") };
}

/** Start an owner on an OS-assigned port with isolated token files. */
export async function startTestBridge(
	overrides: Partial<BridgeOptions> = {},
): Promise<{ port: number; files: ReturnType<typeof tempTokenFiles> }> {
	const files = tempTokenFiles();
	const handle = await start({
		port: 0,
		pairTokenFile: files.pairTokenFile,
		clientTokenFile: files.clientTokenFile,
		...overrides,
	});
	return { port: handle.port, files };
}

/** Open a socket on `path` with optional Origin; resolves on open. */
export function openSocket(
	port: number,
	path = "/",
	origin: string | null = EXTENSION_ORIGIN,
): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const headers: Record<string, string> = origin ? { Origin: origin } : {};
		const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
		const timer = setTimeout(() => reject(new Error("connect timeout")), 3000);
		ws.onopen = () => {
			clearTimeout(timer);
			resolve(ws);
		};
		ws.onerror = () => {
			clearTimeout(timer);
			reject(new Error("connect failed"));
		};
	});
}

/** Connect as the extension and send the hello; resolves once the server registered it. */
export async function connectExtension(
	port: number,
	token = TEST_PAIR_TOKEN,
): Promise<WebSocket> {
	const ws = await openSocket(port);
	ws.send(JSON.stringify({ type: "hello", token }));
	await sleep(50);
	return ws;
}

/** Resolve with the close code of `ws`. */
export function closeCode(ws: WebSocket, timeoutMs = 4000): Promise<number> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("no close")), timeoutMs);
		ws.addEventListener("close", (e) => {
			clearTimeout(timer);
			resolve(e.code);
		});
	});
}

export function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
