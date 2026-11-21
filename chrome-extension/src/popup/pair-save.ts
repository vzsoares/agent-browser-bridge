import { createLogger } from "@agent-browser-bridge/logger";

const logger = createLogger("chrome-ext:pair-save");

export interface PairSaveResult {
	ok: boolean;
	message: string;
}

export const PAIR_SAVED = "Token saved.";
export const PAIR_INVALID = "Paste the pairing token (no spaces).";
export const PAIR_FAILED = "Failed to save the pairing token.";

export async function submitPairToken(
	raw: string,
	save: (token: string) => Promise<void>,
): Promise<PairSaveResult> {
	const token = raw.trim();
	if (token.length === 0 || /\s/.test(token)) {
		return { ok: false, message: PAIR_INVALID };
	}
	try {
		await save(token);
		return { ok: true, message: PAIR_SAVED };
	} catch (e: unknown) {
		logger.error("Failed to save pairing token:", e);
		return { ok: false, message: PAIR_FAILED };
	}
}
