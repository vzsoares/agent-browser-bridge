/**
 * Action log: a ring buffer of the last 1,000 bridge actions in
 * chrome.storage.local, out of the agent's reach.
 *
 * Entries never hold page content or results: URLs keep only
 * origin + pathname, `type` keeps the text length, `exec` the first 500
 * chars of the code.
 *
 * @module infrastructure/action-log
 */

import type { Response } from "@agent-browser-bridge/protocol";

export const ACTION_LOG_KEY = "actionLog";
export const ACTION_LOG_LIMIT = 1000;
export const EXEC_CODE_LIMIT = 500;

export interface ActionLogEntry {
	ts: string;
	action: string;
	tabId: number | null;
	url: string | null;
	selector: string | null;
	ok: boolean;
	error: string | null;
	durationMs: number;
	textLength?: number;
	code?: string;
}

/** `origin + pathname`, dropping query and fragment. */
export function sanitizeUrl(raw: unknown): string | null {
	if (typeof raw !== "string" || raw.length === 0) return null;
	try {
		const u = new URL(raw);
		const base = u.origin === "null" ? u.protocol : u.origin;
		return `${base}${u.pathname}`;
	} catch {
		return null;
	}
}

function field(params: unknown, key: string): unknown {
	if (typeof params !== "object" || params === null) return undefined;
	return Object.entries(params).find(([k]) => k === key)?.[1];
}

export function buildEntry(input: {
	action: string;
	params: unknown;
	tabId: number | null;
	url: string | null;
	response: Response;
	startedAt: number;
	endedAt: number;
}): ActionLogEntry {
	const { action, params, response } = input;
	const selector = field(params, "selector");
	const entry: ActionLogEntry = {
		ts: new Date(input.startedAt).toISOString(),
		action,
		tabId: input.tabId,
		url: sanitizeUrl(input.url),
		selector: typeof selector === "string" ? selector : null,
		ok: response.error === undefined,
		error: response.error?.code ?? null,
		durationMs: Math.max(0, input.endedAt - input.startedAt),
	};
	if (action === "type") {
		const text = field(params, "text");
		entry.textLength = typeof text === "string" ? text.length : 0;
	}
	if (action === "exec") {
		const code = field(params, "code");
		entry.code = typeof code === "string" ? code.slice(0, EXEC_CODE_LIMIT) : "";
	}
	return entry;
}

/** Append `entry`, keeping only the newest `limit` entries. */
export function appendBounded(
	log: readonly ActionLogEntry[],
	entry: ActionLogEntry,
	limit = ACTION_LOG_LIMIT,
): ActionLogEntry[] {
	const next = [...log, entry];
	return next.length > limit ? next.slice(next.length - limit) : next;
}

function isEntry(v: unknown): v is ActionLogEntry {
	return (
		typeof v === "object" &&
		v !== null &&
		"ts" in v &&
		typeof v.ts === "string" &&
		"action" in v &&
		typeof v.action === "string" &&
		"ok" in v &&
		typeof v.ok === "boolean"
	);
}

export async function readActionLog(): Promise<ActionLogEntry[]> {
	try {
		const stored = await chrome.storage.local.get(ACTION_LOG_KEY);
		const raw = stored[ACTION_LOG_KEY];
		return Array.isArray(raw) ? raw.filter(isEntry) : [];
	} catch {
		return [];
	}
}

// Serialises read-modify-write so concurrent appends don't drop entries.
let writeChain: Promise<void> = Promise.resolve();

export function appendActionLog(entry: ActionLogEntry): Promise<void> {
	writeChain = writeChain
		.then(async () => {
			const log = await readActionLog();
			await chrome.storage.local.set({
				[ACTION_LOG_KEY]: appendBounded(log, entry),
			});
		})
		.catch(() => {});
	return writeChain;
}

export async function clearActionLog(): Promise<void> {
	await chrome.storage.local.set({ [ACTION_LOG_KEY]: [] });
}

export function toJsonl(entries: readonly ActionLogEntry[]): string {
	return entries.map((e) => JSON.stringify(e)).join("\n");
}

export function parseJsonl(text: string): ActionLogEntry[] {
	return text
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line): unknown => JSON.parse(line))
		.filter(isEntry);
}
