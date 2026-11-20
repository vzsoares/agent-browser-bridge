/** Action log: entry shape, redaction, ring buffer and JSONL export. */

import { beforeEach, describe, expect, test, vi } from "vitest";
import {
	ACTION_LOG_KEY,
	ACTION_LOG_LIMIT,
	type ActionLogEntry,
	appendActionLog,
	appendBounded,
	buildEntry,
	clearActionLog,
	parseJsonl,
	readActionLog,
	sanitizeUrl,
	toJsonl,
} from "../action-log.js";

let store: Record<string, unknown> = {};

beforeEach(() => {
	store = {};
	vi.stubGlobal("chrome", {
		storage: {
			local: {
				get: vi.fn(async (key: string) => ({ [key]: store[key] })),
				set: vi.fn(async (items: Record<string, unknown>) => {
					Object.assign(store, items);
				}),
			},
		},
	});
});

function entry(i: number): ActionLogEntry {
	return {
		ts: new Date(i).toISOString(),
		action: "read",
		tabId: 1,
		url: null,
		selector: null,
		ok: true,
		error: null,
		durationMs: i,
	};
}

describe("buildEntry", () => {
	test("records the fields and nothing from the result", () => {
		const e = buildEntry({
			action: "click",
			params: { selector: "#go", tabId: 7 },
			tabId: 7,
			url: "https://mail.example.com/inbox?token=secret#msg",
			response: { id: "1", result: { text: "page content" } },
			startedAt: 1000,
			endedAt: 1250,
		});
		expect(e).toEqual({
			ts: new Date(1000).toISOString(),
			action: "click",
			tabId: 7,
			url: "https://mail.example.com/inbox",
			selector: "#go",
			ok: true,
			error: null,
			durationMs: 250,
		});
		expect(JSON.stringify(e)).not.toContain("page content");
	});

	test("type stores the text length, never the text", () => {
		const e = buildEntry({
			action: "type",
			params: { selector: "#pw", text: "hunter2" },
			tabId: 1,
			url: null,
			response: { id: "1", result: { typed: true } },
			startedAt: 0,
			endedAt: 1,
		});
		expect(e.textLength).toBe(7);
		expect(JSON.stringify(e)).not.toContain("hunter2");
	});

	test("exec keeps the first 500 chars of the code", () => {
		const code = "x".repeat(600);
		const e = buildEntry({
			action: "exec",
			params: { code },
			tabId: 1,
			url: null,
			response: { id: "1", error: { code: "TIMEOUT", message: "slow" } },
			startedAt: 0,
			endedAt: 1,
		});
		expect(e.code).toHaveLength(500);
		expect(e.ok).toBe(false);
		expect(e.error).toBe("TIMEOUT");
	});
});

describe("sanitizeUrl", () => {
	test("strips query and fragment", () => {
		expect(sanitizeUrl("https://a.example/p/q?x=1#y")).toBe(
			"https://a.example/p/q",
		);
	});

	test("handles opaque origins and junk", () => {
		expect(sanitizeUrl("about:blank")).toBe("about:blank");
		expect(sanitizeUrl("not a url")).toBeNull();
		expect(sanitizeUrl(undefined)).toBeNull();
	});
});

describe("ring buffer", () => {
	test("keeps the newest 1,000 entries", () => {
		let log: ActionLogEntry[] = [];
		for (let i = 0; i < ACTION_LOG_LIMIT + 5; i++) {
			log = appendBounded(log, entry(i));
		}
		expect(log).toHaveLength(ACTION_LOG_LIMIT);
		expect(log[0]?.durationMs).toBe(5);
		expect(log.at(-1)?.durationMs).toBe(ACTION_LOG_LIMIT + 4);
	});

	test("concurrent appends are all stored, and clear empties", async () => {
		await Promise.all([1, 2, 3].map((i) => appendActionLog(entry(i))));
		expect((await readActionLog()).map((e) => e.durationMs)).toEqual([1, 2, 3]);
		await clearActionLog();
		expect(store[ACTION_LOG_KEY]).toEqual([]);
	});
});

describe("JSONL export", () => {
	test("round-trips", () => {
		const log = [entry(1), { ...entry(2), code: "1+1" }];
		const text = toJsonl(log);
		expect(text.split("\n")).toHaveLength(2);
		expect(parseJsonl(text)).toEqual(log);
	});
});
