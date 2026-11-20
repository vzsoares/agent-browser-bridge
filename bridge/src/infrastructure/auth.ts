/**
 * Bridge authentication: token files, the first-frame `hello`, Origin
 * pinning, and the resolved runtime options.
 *
 * @module infrastructure/auth
 */

import {
	createHash,
	timingSafeEqual as cryptoTimingSafeEqual,
	randomBytes,
} from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** ID derived from the `key` in chrome-extension/manifest.json. */
export const DEFAULT_EXTENSION_ID = "jjlgogdanhhkgglgckdpigepfniilinm";
export const DEFAULT_PORT = 9242;
export const DEFAULT_HOST = "127.0.0.1";
export const HELLO_TIMEOUT_MS = 2000;
export const UNAUTHORIZED_CLOSE_CODE = 4401;
export const REPLACED_CLOSE_CODE = 4000;

export interface BridgeOptions {
	port: number;
	host: string;
	/** Whether the `/client` relay route (and client-mode start) is enabled. */
	clientRoute: boolean;
	extensionId: string;
	pairTokenFile: string;
	clientTokenFile: string;
}

export function configDir(): string {
	return join(homedir(), ".config", "agent-browser-bridge");
}

function parsePort(raw: string | undefined): number {
	if (raw === undefined || raw.trim() === "") return DEFAULT_PORT;
	const n = Number(raw);
	return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : DEFAULT_PORT;
}

/** Resolve options from the environment; explicit overrides win. */
export function resolveBridgeOptions(
	overrides: Partial<BridgeOptions> = {},
	env: NodeJS.ProcessEnv = process.env,
): BridgeOptions {
	const dir = configDir();
	return {
		port: overrides.port ?? parsePort(env.AGENT_BROWSER_PORT),
		host: overrides.host ?? (env.AGENT_BROWSER_HOST || DEFAULT_HOST),
		clientRoute: overrides.clientRoute ?? env.AGENT_BROWSER_CLIENT !== "off",
		extensionId:
			overrides.extensionId ??
			(env.AGENT_BROWSER_EXTENSION_ID || DEFAULT_EXTENSION_ID),
		pairTokenFile:
			overrides.pairTokenFile ??
			(env.AGENT_BROWSER_PAIR_TOKEN_FILE || join(dir, "pair.token")),
		clientTokenFile: overrides.clientTokenFile ?? join(dir, "client.token"),
	};
}

export function generateToken(): string {
	return randomBytes(32).toString("hex");
}

/** Write a token file with mode 0600, creating its directory (0700). */
export function writeTokenFile(path: string, token: string): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	writeFileSync(path, `${token}\n`, { mode: 0o600 });
	// writeFileSync's mode applies only on create.
	chmodSync(path, 0o600);
}

/** Read a token file, or `null` when missing or empty. */
export function readTokenFile(path: string): string | null {
	try {
		const token = readFileSync(path, "utf8").trim();
		return token.length > 0 ? token : null;
	} catch {
		return null;
	}
}

/** Read the pairing token, creating it on first start. */
export function loadOrCreateTokenFile(path: string): string {
	if (existsSync(path)) {
		const token = readTokenFile(path);
		if (token) return token;
		throw new Error(`Token file ${path} is empty or unreadable`);
	}
	const token = generateToken();
	writeTokenFile(path, token);
	return token;
}

/** Constant-time comparison; hashing first hides length differences. */
export function tokensEqual(a: string, b: string): boolean {
	const ha = createHash("sha256").update(a).digest();
	const hb = createHash("sha256").update(b).digest();
	return cryptoTimingSafeEqual(ha, hb) && a.length === b.length;
}

/** Extract the token from a `{"type":"hello","token":"…"}` frame. */
export function parseHello(data: string): string | null {
	let msg: unknown;
	try {
		msg = JSON.parse(data);
	} catch {
		return null;
	}
	if (typeof msg !== "object" || msg === null) return null;
	if (!("type" in msg) || msg.type !== "hello") return null;
	if (!("token" in msg) || typeof msg.token !== "string") return null;
	return msg.token;
}

export function isExtensionOrigin(
	origin: string | undefined,
	extensionId: string,
): boolean {
	return origin === `chrome-extension://${extensionId}`;
}
