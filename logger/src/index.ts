/** Logger for agent-browser-bridge packages.
 *
 * Silent by default. Set `AGENT_BROWSER_BRIDGE_LOG_LEVEL` to enable output:
 *   debug < info < warn < error < silent
 *
 * All output is routed to stderr so it never collides with an MCP stdio
 * server's JSON-RPC channel on stdout. Works in both Node.js and browser
 * contexts.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface Logger {
	debug(...args: unknown[]): void;
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
}

const LEVEL_ORDER: LogLevel[] = ["debug", "info", "warn", "error", "silent"];

function levelIndex(level: LogLevel): number {
	return LEVEL_ORDER.indexOf(level);
}

function getLogLevelFromEnv(): LogLevel {
	try {
		const globalProcess = (globalThis as unknown as Record<string, unknown>)
			.process;
		const env = (globalProcess as Record<string, unknown>).env as
			| Record<string, unknown>
			| undefined;
		const raw = env?.AGENT_BROWSER_BRIDGE_LOG_LEVEL || "";
		const trimmed = String(raw).trim().toLowerCase() as LogLevel;
		if (LEVEL_ORDER.includes(trimmed)) return trimmed;
	} catch {
		// Browser or restricted environment — default to silent
	}
	return "silent";
}

function formatTime(): string {
	const now = new Date();
	const h = String(now.getHours()).padStart(2, "0");
	const m = String(now.getMinutes()).padStart(2, "0");
	const s = String(now.getSeconds()).padStart(2, "0");
	return `${h}:${m}:${s}`;
}

function joinArgs(args: unknown[]): string {
	return args
		.map((a) =>
			typeof a === "string"
				? a
				: a instanceof Error
					? a.message
					: JSON.stringify(a),
		)
		.join(" ");
}

class LoggerImpl implements Logger {
	private _levelIndex: number;
	private _namespace: string;

	constructor(namespace: string, level: LogLevel = getLogLevelFromEnv()) {
		this._namespace = namespace;
		this._levelIndex = levelIndex(level);
	}

	private _shouldLog(target: LogLevel): boolean {
		return levelIndex(target) >= this._levelIndex;
	}

	private _log(level: LogLevel, args: unknown[]): void {
		if (!this._shouldLog(level)) return;
		const prefix = `[${formatTime()} ${level.toUpperCase()} ${this._namespace}]`;
		const message = joinArgs(args);
		// Always write to stderr — stdout is reserved for the MCP JSON-RPC
		// channel and any extra bytes there will corrupt the protocol.
		console.error(prefix, message);
	}

	debug(...args: unknown[]): void {
		this._log("debug", args);
	}

	info(...args: unknown[]): void {
		this._log("info", args);
	}

	warn(...args: unknown[]): void {
		this._log("warn", args);
	}

	error(...args: unknown[]): void {
		this._log("error", args);
	}
}

/** Default shared logger instance (namespace: `agent-browser-bridge`). */
export const logger: Logger = new LoggerImpl("agent-browser-bridge");

/** Create a namespaced logger instance. */
export function createLogger(namespace: string): Logger {
	return new LoggerImpl(namespace);
}
