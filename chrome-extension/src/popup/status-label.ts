import type { ConnectionStatus } from "../infrastructure/chrome-storage.js";

export function statusLabelText(
	status: ConnectionStatus,
	port: number,
): string {
	switch (status) {
		case "connected":
			return "Connected";
		case "connecting":
			return "Connecting…";
		case "waiting":
			return `Waiting for an agent (no bridge on port ${port})`;
		case "disconnected":
			return "Off";
		case "unpaired":
			return "Not paired — paste the pairing token";
	}
}
