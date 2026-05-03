/**
 * Exec action handler — execute arbitrary JavaScript in the page context.
 *
 * Validates parameters, evaluates the user-supplied code, awaits any
 * returned promise, serialises the result safely, and caps output at
 * 10 000 characters.
 *
 * Pure application logic — zero Chrome API dependencies.
 * Uses only JS built-ins (eval, JSON, WeakSet) and domain utilities.
 *
 * @module application/handle-exec
 */

import { withTimeout } from "../domain/index.js";
import type { ExecSuccess } from "./types.js";
import type { ErrorResponse } from "@pi-browser-bridge/protocol";

/** Maximum characters before the serialised output is truncated. */
const MAX_EXEC_OUTPUT = 10_000;

/** Timeout for async code evaluation (ms). */
const EXEC_TIMEOUT_MS = 5_000;

/**
 * Serialise an arbitrary JavaScript value into a human-readable string.
 *
 * - Primitives are returned as-is (`undefined` → `"undefined"`).
 * - Objects/arrays use `JSON.stringify` with a replacer that handles
 *   circular references (`"[Circular]"`), functions (`"[Function: name]"`),
 *   symbols (`"[Symbol: description]"`), and bigints (`.toString()`).
 * - Once serialised, output is capped at {@link MAX_EXEC_OUTPUT} characters.
 */
function serializeExecValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  const t = typeof value;
  if (t === "string") return value as string;
  if (t === "number") return String(value as number);
  if (t === "boolean") return String(value as boolean);
  if (t === "bigint") return `${(value as bigint).toString()}n`;
  if (t === "symbol") {
    const desc = (value as symbol).description;
    return desc ? `[Symbol: ${desc}]` : "[Symbol]";
  }
  if (t === "function") {
    const name = (value as (...args: unknown[]) => unknown).name || "anonymous";
    return `[Function: ${name}]`;
  }

  // Object or array — try native JSON.stringify first, then fall back to
  // a custom replacer that catches circular refs and non-serialisable types.
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    const seen = new WeakSet<object>();
    return JSON.stringify(
      value,
      (_key, val: unknown) => {
        if (val === undefined) return "undefined";
        if (typeof val === "function") {
          return `[Function: ${val.name || "anonymous"}]`;
        }
        if (typeof val === "symbol") {
          const desc = (val as symbol).description;
          return desc ? `[Symbol: ${desc}]` : "[Symbol]";
        }
        if (typeof val === "bigint") return `${val.toString()}n`;
        if (typeof val === "object" && val !== null) {
          if (seen.has(val)) return "[Circular]";
          seen.add(val);
        }
        return val;
      },
      2,
    );
  }
}

/**
 * Execute arbitrary JavaScript code in the active browser tab's page context.
 *
 * Async code (Promises) is automatically awaited with a 5 s timeout.
 * The return value is serialised for safe display (capped at 10 000 characters).
 *
 * @param params — Raw exec parameters ({@link ExecParams}).
 * @returns A structured exec result on success, or a protocol error on failure.
 */
export async function handleExec(
  params: unknown,
): Promise<ExecSuccess | ErrorResponse> {
  const p = params as { code?: string } | null | undefined;
  if (!p || typeof p.code !== "string" || p.code.trim().length === 0) {
    return {
      code: "UNKNOWN_ACTION",
      message: "Missing or invalid 'code' parameter.",
      suggestion: "Provide a string of JavaScript code to execute.",
    };
  }

  const code = p.code;

  // ── Evaluate the user code ───────────────────────────────────────────
  let raw: unknown;
  try {
    raw = globalThis.eval?.(code);
  } catch (syncErr) {
    const msg = syncErr instanceof Error ? syncErr.message : String(syncErr);
    return {
      value: undefined,
      serialized: `Error: ${msg}`,
    };
  }

  // If the evaluated code returned a thenable, await it with timeout.
  if (
    raw !== null &&
    typeof raw === "object" &&
    typeof (raw as Promise<unknown>).then === "function"
  ) {
    try {
      raw = await withTimeout(raw as Promise<unknown>, EXEC_TIMEOUT_MS);
    } catch (asyncErr) {
      const msg =
        asyncErr instanceof Error ? asyncErr.message : String(asyncErr);
      return {
        value: undefined,
        serialized: `Error: ${msg}`,
      };
    }
  }

  // ── Serialise the result ─────────────────────────────────────────────
  const serializedFull = serializeExecValue(raw);

  let serialized: string;
  if (serializedFull.length > MAX_EXEC_OUTPUT) {
    serialized =
      serializedFull.slice(0, MAX_EXEC_OUTPUT) +
      `\n... [truncated at ${MAX_EXEC_OUTPUT} chars, total ${serializedFull.length}]`;
  } else {
    serialized = serializedFull;
  }

  return { value: raw, serialized };
}
