import { GhosttyLaunchError } from "./ghostty.js";
import { TmuxLaunchError } from "./tmux.js";

export type FleetTerminal = "tmux" | "ghostty";
export type TerminalSplitDirection = "right" | "down" | "left" | "up";

export function normalizeTerminal(value: FleetTerminal | undefined): FleetTerminal {
	if (value === undefined || value === "tmux") return "tmux";
	if (value === "ghostty") return "ghostty";
	throw new Error("Pi Fleet terminal must be tmux or ghostty");
}

export function isTerminalLaunchError(
	error: unknown,
): error is GhosttyLaunchError | TmuxLaunchError {
	return error instanceof GhosttyLaunchError || error instanceof TmuxLaunchError;
}

export function createTerminalLaunchError(
	terminal: FleetTerminal,
	message: string,
	splitCreated: boolean,
	terminalId?: string,
): GhosttyLaunchError | TmuxLaunchError {
	return terminal === "ghostty"
		? new GhosttyLaunchError(message, splitCreated, terminalId)
		: new TmuxLaunchError(message, splitCreated, terminalId);
}
