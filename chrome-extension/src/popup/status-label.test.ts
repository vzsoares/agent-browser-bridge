import { describe, expect, it } from "vitest";
import { statusLabelText } from "./status-label.js";

describe("statusLabelText", () => {
	it("says waiting with the port when no bridge answers", () => {
		expect(statusLabelText("waiting", 9242)).toBe(
			"Waiting for an agent (no bridge on port 9242)",
		);
	});

	it("says Connecting… only while an attempt is in flight", () => {
		expect(statusLabelText("connecting", 9242)).toBe("Connecting…");
	});

	it("keeps Connected unchanged", () => {
		expect(statusLabelText("connected", 9242)).toBe("Connected");
	});
});
