import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { MenuDefinition } from "@narumitw/pi-tui-kit";
import type { FleetSnapshot, SpawnSessionInput } from "./fleet-controller.js";
import { safeError, safeTerminalLine } from "./text.js";

export interface FleetMenuSource {
	snapshot(signal?: AbortSignal): Promise<FleetSnapshot>;
	acceptExperimentalWarning(ctx: ExtensionCommandContext, signal?: AbortSignal): Promise<boolean>;
	spawn(
		ctx: ExtensionCommandContext,
		input: SpawnSessionInput,
		signal?: AbortSignal,
	): Promise<void>;
	start(ctx: ExtensionCommandContext, signal?: AbortSignal): Promise<void>;
	join(ctx: ExtensionCommandContext, invite: string, signal?: AbortSignal): Promise<void>;
	send(
		ctx: ExtensionCommandContext,
		options: { targetSessionId: string; text: string; mode: "notify" | "request" },
		signal?: AbortSignal,
	): Promise<void>;
	setAcceptsRequests(value: boolean): void;
	leave(): Promise<void>;
}

type Screen =
	| "main"
	| "join"
	| "sessions"
	| "invite"
	| "requestPolicy"
	| "status"
	| "help"
	| "leave";
type Action = "spawn" | "start" | "join" | "send" | "setPolicy" | "leave";

const TERMINAL_OPTIONS = ["tmux — default", "Ghostty — explicit opt-in"] as const;
const DIRECTION_OPTIONS = ["Right", "Down", "Left", "Up"] as const;

export function createFleetMenu(source: FleetMenuSource) {
	const getState = ({ signal }: { signal?: AbortSignal } = {}) => source.snapshot(signal);
	const menu: MenuDefinition<FleetSnapshot, Screen, Action> = {
		start: "main",
		screens: {
			main: ({ state }) => mainScreen(state),
			join: () => ({
				kind: "input",
				title: "Join Pi Fleet",
				lines: [
					"Paste a local pifleet:v1 bearer invite.",
					"Anyone holding it can message this Pi session while both processes are running.",
				],
				placeholder: "pifleet:v1:…",
				action: "join",
				hint: "back",
			}),
			sessions: ({ state }) => ({
				kind: "browse",
				title: "Pi Fleet sessions",
				lines: state.peers.length
					? ["Authenticated live sessions in this ephemeral local group."]
					: ["No other live sessions are currently authenticated."],
				items: state.peers.map((peer) => ({
					id: peer.sessionId,
					label: safeTerminalLine(peer.name ?? peer.sessionId),
					statusText: peer.acceptsRequests ? "requests allowed" : "messages only",
					description: safeTerminalLine(peer.cwd),
					details: [
						`Session: ${safeTerminalLine(peer.sessionId)}`,
						`Process: ${peer.pid}`,
						...(peer.launchId ? [`Launch: ${safeTerminalLine(peer.launchId)}`] : []),
					],
				})),
				viewportSize: "adaptive",
				hint: "back",
			}),
			invite: ({ state }) => ({
				kind: "review",
				title: "Pi Fleet bearer invite",
				lines: [
					"Copy this only into another local Pi session you trust.",
					"Pi Fleet does not save the invite, but any copied bearer remains usable until its holder discards it.",
				],
				content: state.invite ?? "Invite is unavailable.",
				format: { kind: "text" },
				viewportSize: "adaptive",
				hint: "back",
			}),
			requestPolicy: ({ state }) => ({
				kind: "choice",
				title: "Incoming agent requests",
				lines: [
					"Messages always enter context without starting a turn.",
					"Allowed requests may spend model tokens and edit this workspace concurrently.",
				],
				items: [
					{ id: "block", label: "Messages only", description: "Do not start remote-request turns" },
					{ id: "allow", label: "Allow requests", description: "Permit one turn per request" },
				],
				action: "setPolicy",
				currentItemId: state.acceptsRequests ? "allow" : "block",
				initialItemId: state.acceptsRequests ? "allow" : "block",
				viewportSize: 4,
				hint: "back",
			}),
			status: ({ state }) => ({
				kind: "detail",
				title: "Pi Fleet status",
				lines: state.connected
					? [
							"State: connected",
							`Session: ${safeTerminalLine(state.self?.name ?? state.self?.sessionId ?? "unknown")}`,
							`Cwd: ${safeTerminalLine(state.self?.cwd ?? "unknown")}`,
							`Other live sessions: ${state.peers.length}`,
							`Incoming requests: ${state.acceptsRequests ? "allowed" : "blocked"}`,
							"Delivery acknowledgement means extension acceptance, not remote task completion.",
						]
					: ["State: disconnected", "No socket, group secret, or background discovery is active."],
				hint: "back",
			}),
			help: () => ({
				kind: "detail",
				title: "Pi Fleet help",
				lines: [
					"Pi Fleet is experimental and connects explicit sessions owned by one OS user.",
					"New Pi session creates a separate process in a terminal split and preserves the parent.",
					"tmux 3.2 or newer is the default; Ghostty 1.3 on macOS requires explicit selection.",
					"Notify messages do not start turns, requests require recipient permission, and replies do not auto-trigger another turn.",
					"Groups, invites, peer state, and message deduplication are ephemeral.",
				],
				hint: "back",
			}),
			leave: ({ state }) => ({
				kind: "review",
				title: "Leave Pi Fleet group?",
				lines: [
					`Other live sessions: ${state.peers.length}`,
					"Leaving closes this session's socket and forgets its in-memory bearer invite.",
				],
				content: "Already delivered peer messages remain in each Pi session transcript.",
				format: { kind: "text" },
				confirm: { id: "leave", label: "Leave group", action: "leave" },
				hint: "back",
			}),
		},
		actions: {
			spawn: async ({ ctx, signal }) => {
				const terminalChoice = await ctx.ui.select(
					"Terminal split backend",
					[...TERMINAL_OPTIONS],
					{ signal },
				);
				if (!terminalChoice || signal.aborted) return { kind: "stay" };
				const terminal = terminalChoice === TERMINAL_OPTIONS[0] ? "tmux" : "ghostty";
				const directionChoice = await ctx.ui.select(
					`${terminal === "tmux" ? "tmux" : "Ghostty"} split direction`,
					[...DIRECTION_OPTIONS],
					{ signal },
				);
				if (!directionChoice || signal.aborted) return { kind: "stay" };
				const task = await ctx.ui.input(
					"Optional first task",
					"Submit an empty value for an idle child session",
					{ signal },
				);
				if (task === undefined || signal.aborted) return { kind: "stay" };
				await source.spawn(
					ctx,
					{
						terminal,
						direction: directionChoice.toLowerCase() as SpawnSessionInput["direction"],
						...(task ? { task } : {}),
					},
					signal,
				);
				return { kind: "close" };
			},
			start: async ({ ctx, signal }) => {
				if (!(await source.acceptExperimentalWarning(ctx, signal)) || signal.aborted) {
					return { kind: "stay" };
				}
				const confirmed = await ctx.ui.confirm(
					"Start local Pi Fleet group?",
					"This creates one owner-only Unix socket and an ephemeral bearer invite. Incoming requests start blocked.",
					{ signal },
				);
				if (!confirmed || signal.aborted) return { kind: "stay" };
				await source.start(ctx, signal);
				return { kind: "stay" };
			},
			join: async ({ ctx, signal, value }) => {
				if (!(await source.acceptExperimentalWarning(ctx, signal)) || signal.aborted) {
					return { kind: "stay" };
				}
				if (!value) return { kind: "rejected", error: new Error("Pi Fleet invite is required") };
				const confirmed = await ctx.ui.confirm(
					"Join local Pi Fleet group?",
					"The bearer invite permits local peer messages. Incoming agent requests start blocked.",
					{ signal },
				);
				if (!confirmed || signal.aborted) return { kind: "stay" };
				await source.join(ctx, value, signal);
				return { kind: "to", screen: "main" };
			},
			send: async ({ ctx, signal, state }) => {
				if (state.peers.length === 0) {
					return { kind: "rejected", error: new Error("No other live Pi Fleet sessions") };
				}
				const labels = state.peers.map(
					(peer) =>
						`${safeTerminalLine(peer.name ?? peer.sessionId)} · ${safeTerminalLine(peer.sessionId)}`,
				);
				const selected = await ctx.ui.select("Send to Pi session", labels, { signal });
				if (!selected || signal.aborted) return { kind: "stay" };
				const peer = state.peers[labels.indexOf(selected)];
				if (!peer) return { kind: "rejected", error: new Error("Selected peer is stale") };
				const modeLabel = await ctx.ui.select(
					"Delivery mode",
					["Message only", "Agent request — may start a paid turn"],
					{ signal },
				);
				if (!modeLabel || signal.aborted) return { kind: "stay" };
				const text = await ctx.ui.input("Message", "Type a bounded message", { signal });
				if (!text || signal.aborted) return { kind: "stay" };
				await source.send(
					ctx,
					{
						targetSessionId: peer.sessionId,
						text,
						mode: modeLabel.startsWith("Agent request") ? "request" : "notify",
					},
					signal,
				);
				return { kind: "stay" };
			},
			setPolicy: async ({ ctx, signal, itemId }) => {
				const allow = itemId === "allow";
				if (itemId !== "allow" && itemId !== "block") {
					return { kind: "rejected", error: new Error("Pi Fleet request policy is invalid") };
				}
				if (allow) {
					const confirmed = await ctx.ui.confirm(
						"Allow incoming agent requests?",
						"A trusted invite holder may start paid model turns that can edit the current workspace.",
						{ signal },
					);
					if (!confirmed || signal.aborted) return { kind: "stay" };
				}
				source.setAcceptsRequests(allow);
				return { kind: "to", screen: "requestPolicy" };
			},
			leave: async () => {
				await source.leave();
				return { kind: "to", screen: "main" };
			},
		},
	};
	return { menu, getState };
}

export async function showFleetMenu(
	ctx: ExtensionCommandContext,
	source: FleetMenuSource,
	ownership: { signal: AbortSignal; isCurrent(): boolean },
): Promise<void> {
	const { runMenu } = await import("@narumitw/pi-tui-kit");
	if (ownership.signal.aborted || !ownership.isCurrent()) return;
	const controller = createFleetMenu(source);
	await runMenu(ctx, controller.menu, {
		getState: controller.getState,
		signal: ownership.signal,
		isCurrent: ownership.isCurrent,
		onError: (_ctx, error) => {
			if (ownership.isCurrent() && !ownership.signal.aborted) {
				ctx.ui.notify(`Pi Fleet failed: ${safeError(error)}`, "error");
			}
		},
	});
}

function mainScreen(state: FleetSnapshot) {
	if (!state.connected) {
		return {
			kind: "actions" as const,
			title: "Pi Fleet · disconnected",
			lines: ["Experimental local Pi sessions with confirmed terminal launch and messaging."],
			items: [
				{
					id: "spawn",
					label: "New Pi session…",
					action: "spawn" as const,
					busyLabel: "Launching",
				},
				{ id: "join", label: "Join with invite", to: "join" as const },
				{ id: "start", label: "Start local group", action: "start" as const },
				{ id: "status", label: "Status", to: "status" as const },
				{ id: "help", label: "Help", to: "help" as const },
			],
			hint: "close" as const,
		};
	}
	return {
		kind: "actions" as const,
		title: `Pi Fleet · ${safeTerminalLine(state.self?.name ?? state.self?.sessionId ?? "connected")}`,
		lines: [
			`${state.peers.length} other live session${state.peers.length === 1 ? "" : "s"} · incoming requests ${state.acceptsRequests ? "allowed" : "blocked"}`,
			"Delivery acknowledgement confirms extension acceptance only.",
		],
		items: [
			{
				id: "spawn",
				label: "New Pi session…",
				action: "spawn" as const,
				busyLabel: "Launching",
			},
			{ id: "send", label: "Send message", action: "send" as const },
			{ id: "sessions", label: "Sessions", to: "sessions" as const },
			{ id: "invite", label: "Invite another session", to: "invite" as const },
			{ id: "policy", label: "Request policy", to: "requestPolicy" as const },
			{ id: "status", label: "Status", to: "status" as const },
			{ id: "help", label: "Help", to: "help" as const },
			{ id: "leave", label: "Leave group…", to: "leave" as const },
		],
		hint: "close" as const,
	};
}
