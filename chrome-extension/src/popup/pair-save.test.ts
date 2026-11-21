import { describe, expect, it, vi } from "vitest";
import {
	PAIR_FAILED,
	PAIR_INVALID,
	PAIR_SAVED,
	submitPairToken,
} from "./pair-save.js";

describe("submitPairToken", () => {
	it("saves a trimmed token and reports success", async () => {
		const save = vi.fn().mockResolvedValue(undefined);
		await expect(submitPairToken("  abc123  ", save)).resolves.toEqual({
			ok: true,
			message: PAIR_SAVED,
		});
		expect(save).toHaveBeenCalledWith("abc123");
	});

	it.each(["", "   ", "ab cd"])("rejects %j without saving", async (raw) => {
		const save = vi.fn();
		await expect(submitPairToken(raw, save)).resolves.toEqual({
			ok: false,
			message: PAIR_INVALID,
		});
		expect(save).not.toHaveBeenCalled();
	});

	it("reports a storage failure", async () => {
		const save = vi.fn().mockRejectedValue(new Error("quota"));
		await expect(submitPairToken("abc", save)).resolves.toEqual({
			ok: false,
			message: PAIR_FAILED,
		});
	});
});
