import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { GhosttyAdapter, GhosttyLaunchError } from "./ghostty.js";
import { TmuxAdapter, TmuxLaunchError } from "./tmux.js";
import { ZellijAdapter, ZellijLaunchError } from "./zellij.js";

export type FleetTerminal = "tmux" | "ghostty" | "zellij";
export type TerminalSplitDirection = "right" | "down" | "left" | "up";

export interface FleetTerminalPort {
	assertAvailable(signal?: AbortSignal): Promise<string>;
	spawnSplit(options: {
		direction: TerminalSplitDirection;
		cwd: string;
		launcherCommand: string;
		environment: Readonly<Record<string, string>>;
		signal?: AbortSignal;
		isCurrent(): boolean;
	}): Promise<{ terminalId: string; version: string }>;
}

export function normalizeTerminal(value: FleetTerminal | undefined): FleetTerminal {
	if (value === undefined || value === "tmux") return "tmux";
	if (value === "ghostty" || value === "zellij") return value;
	throw new Error("Pi Fleet terminal must be tmux, ghostty, or zellij");
}

export function terminalLabel(terminal: FleetTerminal): string {
	switch (terminal) {
		case "tmux":
			return "tmux";
		case "ghostty":
			return "Ghostty";
		case "zellij":
			return "Zellij";
	}
}

export function createDefaultTerminalPort(
	pi: ExtensionAPI,
	terminal: FleetTerminal,
): FleetTerminalPort {
	const options = {
		execute: async (
			command: string,
			args: string[],
			execution: {
				signal?: AbortSignal;
				timeoutMs: number;
			},
		) =>
			pi.exec(command, args, {
				...(execution.signal ? { signal: execution.signal } : {}),
				timeout: execution.timeoutMs,
			}),
	};
	switch (terminal) {
		case "tmux":
			return new TmuxAdapter(options);
		case "ghostty":
			return new GhosttyAdapter(options);
		case "zellij":
			return new ZellijAdapter(options);
	}
}

export function isTerminalLaunchError(
	error: unknown,
): error is GhosttyLaunchError | TmuxLaunchError | ZellijLaunchError {
	return (
		error instanceof GhosttyLaunchError ||
		error instanceof TmuxLaunchError ||
		error instanceof ZellijLaunchError
	);
}

export function createTerminalLaunchError(
	terminal: FleetTerminal,
	message: string,
	splitCreated: boolean,
	terminalId?: string,
): GhosttyLaunchError | TmuxLaunchError | ZellijLaunchError {
	switch (terminal) {
		case "tmux":
			return new TmuxLaunchError(message, splitCreated, terminalId);
		case "ghostty":
			return new GhosttyLaunchError(message, splitCreated, terminalId);
		case "zellij":
			return new ZellijLaunchError(message, splitCreated, terminalId);
	}
}
