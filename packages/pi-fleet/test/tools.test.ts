import assert from "node:assert/strict";
import { test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import type { FleetSnapshot, SpawnSessionResult } from "../src/fleet-controller.js";
import { type FleetToolController, registerFleetTools } from "../src/tools.js";

function stubController(overrides: Partial<FleetToolController> = {}) {
	const calls: unknown[] = [];
	const snapshot: FleetSnapshot = {
		connected: true,
		acceptsRequests: false,
		peers: [
			{
				protocolVersion: 1,
				sessionId: "peer-1",
				name: "Peer One",
				cwd: "/tmp/peer",
				pid: 123,
				acceptsRequests: true,
			},
		],
	};
	const spawnResult: SpawnSessionResult = {
		sessionId: "child",
		name: "Child",
		cwd: "/tmp/child",
		terminalId: "terminal-child",
		ghosttyVersion: "1.3.1",
		kickoffAccepted: true,
	};
	const controller: FleetToolController = {
		spawn: async (_ctx, input) => {
			calls.push({ kind: "spawn", input });
			return spawnResult;
		},
		snapshot: async () => snapshot,
		send: async (_ctx, input) => {
			calls.push({ kind: "send", input });
			return {
				message: {
					id: "msg_1234567890",
					fromSessionId: "self",
					toSessionId: input.targetSessionId,
					mode: input.mode,
					text: input.text,
					issuedAt: Date.now(),
					...(input.replyTo ? { replyTo: input.replyTo } : {}),
				},
				acknowledgement: { accepted: true, duplicate: false },
			};
		},
		...overrides,
	};
	return { controller, calls, snapshot, spawnResult };
}

test("registers separate spawn and bus tools with focused schemas", () => {
	const mock = createMockPi();
	const { controller } = stubController();
	registerFleetTools(mock.pi, controller);
	assert.deepEqual(
		mock.tools.map((tool) => tool.name),
		["session_spawn", "session_bus"],
	);
	const spawn = mock.tools[0] as { parameters: { properties?: Record<string, unknown> } };
	const bus = mock.tools[1] as { parameters: { properties?: Record<string, unknown> } };
	assert.deepEqual(Object.keys(spawn.parameters.properties ?? {}).sort(), [
		"cwd",
		"direction",
		"name",
		"task",
	]);
	assert.deepEqual(Object.keys(bus.parameters.properties ?? {}).sort(), [
		"action",
		"message",
		"mode",
		"replyTo",
		"targetSessionId",
	]);
});

test("session_spawn delegates launch input and returns readiness without secrets", async () => {
	const mock = createMockPi();
	const { controller, calls } = stubController();
	registerFleetTools(mock.pi, controller);
	const tool = mock.tools.find(({ name }) => name === "session_spawn") as {
		execute(...args: unknown[]): Promise<{ content: Array<{ text: string }>; details: unknown }>;
	};
	const context = createMockContext({ mode: "tui", hasUI: true });
	const result = await tool.execute(
		"call-1",
		{ direction: "down", task: "check tests", name: "Child", cwd: "/tmp/child" },
		undefined,
		undefined,
		context.ctx,
	);
	assert.deepEqual(calls, [
		{
			kind: "spawn",
			input: { direction: "down", task: "check tests", name: "Child", cwd: "/tmp/child" },
		},
	]);
	assert.match(result.content[0]?.text ?? "", /child.*ready/iu);
	assert.equal(JSON.stringify(result).includes("pifleet:v1"), false);
});

test("session_bus lists peers, sends requests, and correlates replies", async () => {
	const mock = createMockPi();
	const { controller, calls } = stubController();
	registerFleetTools(mock.pi, controller);
	const tool = mock.tools.find(({ name }) => name === "session_bus") as {
		execute(...args: unknown[]): Promise<{ content: Array<{ text: string }>; details: unknown }>;
	};
	const context = createMockContext({ mode: "tui", hasUI: true });
	const listed = await tool.execute(
		"call-list",
		{ action: "list" },
		undefined,
		undefined,
		context.ctx,
	);
	assert.match(listed.content[0]?.text ?? "", /Peer One/u);
	await tool.execute(
		"call-send",
		{ action: "send", targetSessionId: "peer-1", mode: "request", message: "review" },
		undefined,
		undefined,
		context.ctx,
	);
	await tool.execute(
		"call-reply",
		{
			action: "reply",
			targetSessionId: "peer-1",
			replyTo: "msg_original_1234",
			message: "done",
		},
		undefined,
		undefined,
		context.ctx,
	);
	assert.deepEqual(calls.slice(0), [
		{
			kind: "send",
			input: { targetSessionId: "peer-1", text: "review", mode: "request" },
		},
		{
			kind: "send",
			input: {
				targetSessionId: "peer-1",
				text: "done",
				mode: "reply",
				replyTo: "msg_original_1234",
			},
		},
	]);
});

test("session_bus throws on invalid action fields and rejected acknowledgement", async () => {
	const mock = createMockPi();
	const { controller } = stubController({
		send: async () => ({
			message: {
				id: "msg_1234567890",
				fromSessionId: "self",
				toSessionId: "peer-1",
				mode: "request",
				text: "review",
				issuedAt: Date.now(),
			},
			acknowledgement: {
				accepted: false,
				duplicate: false,
				error: "Target session does not allow agent requests",
			},
		}),
	});
	registerFleetTools(mock.pi, controller);
	const tool = mock.tools.find(({ name }) => name === "session_bus") as {
		execute(...args: unknown[]): Promise<unknown>;
	};
	const context = createMockContext({ mode: "tui", hasUI: true });
	await assert.rejects(
		tool.execute(
			"call-send",
			{ action: "send", targetSessionId: "peer-1", mode: "request", message: "review" },
			undefined,
			undefined,
			context.ctx,
		),
		/does not allow agent requests/u,
	);
	await assert.rejects(
		tool.execute(
			"call-reply",
			{ action: "reply", message: "missing ids" },
			undefined,
			undefined,
			context.ctx,
		),
		/targetSessionId/u,
	);
});
