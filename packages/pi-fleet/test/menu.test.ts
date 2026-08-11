import assert from "node:assert/strict";
import { test } from "vitest";
import { createMockContext } from "../../../test/support.js";
import type { FleetSnapshot, SpawnSessionInput } from "../src/fleet-controller.js";
import { createFleetMenu, type FleetMenuSource } from "../src/menu.js";

const disconnected: FleetSnapshot = {
	connected: false,
	acceptsRequests: false,
	peers: [],
};
const connected: FleetSnapshot = {
	connected: true,
	groupId: "a".repeat(32),
	invite: `pifleet:v1:${"A".repeat(43)}`,
	acceptsRequests: false,
	self: {
		protocolVersion: 2,
		sessionId: "self",
		endpointId: "a".repeat(24),
		name: "Main",
		cwd: "/tmp/main",
		pid: 123,
		acceptsRequests: false,
	},
	peers: [
		{
			protocolVersion: 2,
			sessionId: "peer",
			endpointId: "b".repeat(24),
			name: "Peer",
			cwd: "/tmp/peer",
			pid: 456,
			acceptsRequests: true,
		},
	],
};

function source(overrides: Partial<FleetMenuSource> = {}) {
	const calls: unknown[] = [];
	const value: FleetMenuSource = {
		snapshot: async () => disconnected,
		acceptExperimentalWarning: async () => true,
		spawn: async (_ctx, input) => {
			calls.push({ kind: "spawn", input });
		},
		start: async () => {
			calls.push({ kind: "start" });
		},
		join: async (_ctx, invite) => {
			calls.push({ kind: "join", invite });
		},
		send: async (_ctx, options) => {
			calls.push({ kind: "send", options });
		},
		setAcceptsRequests: (value) => {
			calls.push({ kind: "policy", value });
		},
		leave: async () => {
			calls.push({ kind: "leave" });
		},
		...overrides,
	};
	return { source: value, calls };
}

test("main menu keeps New Pi session first when disconnected or connected", () => {
	const first = source({ snapshot: async () => disconnected });
	const firstMenu = createFleetMenu(first.source);
	assert.deepEqual(
		(
			firstMenu.menu.screens.main({ state: disconnected }) as unknown as {
				items: ReadonlyArray<{ label: string }>;
			}
		).items.map(({ label }) => label),
		["New Pi session in Ghostty", "Join with invite", "Start local group", "Status", "Help"],
	);
	const second = source({ snapshot: async () => connected });
	const secondMenu = createFleetMenu(second.source);
	assert.deepEqual(
		(
			secondMenu.menu.screens.main({ state: connected }) as unknown as {
				items: ReadonlyArray<{ label: string }>;
			}
		).items.map(({ label }) => label),
		[
			"New Pi session in Ghostty",
			"Send message",
			"Sessions",
			"Invite another session",
			"Request policy",
			"Status",
			"Help",
			"Leave group…",
		],
	);
});

test("spawn collects direction and preserves the first task", async () => {
	const { source: menuSource, calls } = source({ snapshot: async () => disconnected });
	const { menu } = createFleetMenu(menuSource);
	const selections = ["Down", undefined];
	const context = createMockContext({
		mode: "tui",
		hasUI: true,
		select: async () => selections.shift(),
		input: async () => "Investigate tests",
	});
	const result = await menu.actions.spawn({
		ctx: context.ctx,
		state: disconnected,
		signal: new AbortController().signal,
		itemId: "spawn",
	});
	assert.deepEqual(result, { kind: "close" });
	assert.deepEqual(calls, [
		{
			kind: "spawn",
			input: { direction: "down", task: "Investigate tests" } satisfies SpawnSessionInput,
		},
	]);
});

test("cancelled warning and dialogs create no group, join, or spawn side effects", async () => {
	const { source: menuSource, calls } = source({
		acceptExperimentalWarning: async () => false,
	});
	const { menu } = createFleetMenu(menuSource);
	const context = createMockContext({ mode: "tui", hasUI: true });
	assert.deepEqual(
		await menu.actions.start({
			ctx: context.ctx,
			state: disconnected,
			signal: new AbortController().signal,
			itemId: "start",
		}),
		{ kind: "stay" },
	);
	assert.deepEqual(
		await menu.actions.join({
			ctx: context.ctx,
			state: disconnected,
			signal: new AbortController().signal,
			itemId: "join",
			value: `pifleet:v1:${"A".repeat(43)}`,
		}),
		{ kind: "stay" },
	);
	assert.deepEqual(calls, []);
});

test("request policy warns before enabling and leave requires its review action", async () => {
	const { source: menuSource, calls } = source({ snapshot: async () => connected });
	const { menu } = createFleetMenu(menuSource);
	const context = createMockContext({ mode: "tui", hasUI: true, confirm: async () => true });
	assert.deepEqual(
		await menu.actions.setPolicy({
			ctx: context.ctx,
			state: connected,
			signal: new AbortController().signal,
			itemId: "allow",
		}),
		{ kind: "to", screen: "requestPolicy" },
	);
	assert.deepEqual(
		await menu.actions.leave({
			ctx: context.ctx,
			state: connected,
			signal: new AbortController().signal,
			itemId: "leave",
		}),
		{ kind: "to", screen: "main" },
	);
	assert.deepEqual(calls, [{ kind: "policy", value: true }, { kind: "leave" }]);
});
