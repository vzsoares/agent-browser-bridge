/**
 * Message dispatcher — route incoming actions to the correct handler.
 *
 * Maps action name strings to handler functions and provides a single
 * `dispatch()` entry point. When an unknown action is received, a
 * structured error response is returned immediately.
 *
 * Pure application logic — imports only from domain/ and sibling
 * application handler modules.
 *
 * @module application/dispatcher
 */

import type { ErrorResponse } from "@agent-browser-bridge/protocol";

import { handleClick } from "./handle-click.js";
import { handleNavigate } from "./handle-navigate.js";
import { handleRead } from "./handle-read.js";
import { handleType } from "./handle-type.js";
import { handleWaitForElement } from "./handle-wait-for-element.js";
import { handleWaitForText } from "./handle-wait-for-text.js";

// ── Handler type ────────────────────────────────────────────────────────────

/** Signature for every action handler. */
type ActionHandler = (params: unknown) => Promise<unknown>;

/**
 * Mapping from action name to handler.
 *
 * Note: `exec` is intentionally absent — it is handled in the service
 * worker via `chrome.scripting.executeScript({ world: "MAIN" })` so it
 * bypasses the extension's CSP. The content-script `handleExec` module
 * is retained for unit-test coverage only.
 */
const handlers = new Map<string, ActionHandler>([
	["navigate", handleNavigate as ActionHandler],
	["click", handleClick as ActionHandler],
	["type", handleType as ActionHandler],
	["read", handleRead as ActionHandler],
	["waitForElement", handleWaitForElement as ActionHandler],
	["waitForText", handleWaitForText as ActionHandler],
]);

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * List of all supported action names.
 */
export const ALL_ACTIONS = [...handlers.keys()] as const;

/**
 * Dispatch an action by name to the matching handler.
 *
 * @param action — Action name (e.g. `"click"`, `"navigate"`, …).
 * @param params — Action-specific parameters (raw, unvalidated).
 * @returns The handler's result. For unknown actions, a structured error
 *   response with code `"UNKNOWN_ACTION"` is returned.
 */
export async function dispatch(
	action: string,
	params: unknown,
): Promise<unknown> {
	const handler = handlers.get(action);

	if (!handler) {
		const error: ErrorResponse = {
			code: "UNKNOWN_ACTION",
			message: `Unknown action: "${action}"`,
			suggestion: `Supported actions: ${[...handlers.keys()].join(", ")}`,
		};
		return error;
	}

	return handler(params);
}
