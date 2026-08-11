import assert from "node:assert/strict";
import { test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import {
	FleetController,
	type FleetControllerDependencies,
	type FleetGhosttyPort,
	type FleetTransportPort,
} from "../src/fleet-controller.js";
import { GhosttyLaunchError } from "../src/ghostty.js";
import type { FleetMessage, FleetPeerDescription } from "../src/protocol.js";
import type { FleetDeliveryAck, FleetTransportOptions } from "../src/transport.js";

class SpawnTransport implements FleetTransportPort {
	peers: FleetPeerDescription[] = [];
	messages: FleetMessage[] = [];
	stopped = 0;
	beforeList?: () => void;
	readonly endpointManifest = {
		directory: "/tmp/pi-fleet-spawn-test",
		socketPath: "/tmp/pi-fleet-spawn-test/endpoint.sock",
		manifestPath: "/tmp/pi-fleet-spawn-test/endpoint.json",
	};
	constructor(readonly options: FleetTransportOptions) {}
	async start() {}
	async stop() {
		this.stopped += 1;
	}
	async listPeers() {
		this.beforeList?.();
		return [...this.peers];
	}
	async send(_targetSessionId: string, message: FleetMessage): Promise<FleetDeliveryAck> {
		this.messages.push(message);
		return { accepted: true, duplicate: false };
	}
	setAcceptsRequests(value: boolean) {
		this.options.peer.acceptsRequests = value;
	}
	get peerDescription() {
		return { ...this.options.peer, endpointId: "a".repeat(24) };
	}
}

function harness(options: { ready?: boolean; ghosttyError?: Error } = {}) {
	const mock = createMockPi();
	const transports: SpawnTransport[] = [];
	const splitCalls: Parameters<FleetGhosttyPort["spawnSplit"]>[0][] = [];
	let now = 1_800_000_000_000;
	let launcherCleaned = false;
	let cleanupStateAtFirstPoll: boolean | undefined;
	let pendingPeer: FleetPeerDescription | undefined;
	const deps: FleetControllerDependencies = {
		createTransport: (transportOptions) => {
			const transport = new SpawnTransport(transportOptions);
			transport.beforeList = () => {
				if (splitCalls.length > 0 && cleanupStateAtFirstPoll === undefined) {
					cleanupStateAtFirstPoll = launcherCleaned;
				}
				if (pendingPeer) {
					transport.peers.push(pendingPeer);
					pendingPeer = undefined;
				}
			};
			transports.push(transport);
			return transport;
		},
		createGhostty: () => ({
			assertAvailable: async () => "1.3.1",
			spawnSplit: async (spawnOptions) => {
				splitCalls.push(spawnOptions);
				if (options.ghosttyError) throw options.ghosttyError;
				if (options.ready !== false) {
					pendingPeer = {
						protocolVersion: 2,
						sessionId: "child-session",
						endpointId: "b".repeat(24),
						name: spawnOptions.environment.PI_FLEET_CHILD_NAME,
						cwd: spawnOptions.cwd,
						pid: 456,
						launchId: spawnOptions.environment.PI_FLEET_LAUNCH_ID,
						acceptsRequests: false,
					};
				}
				return { terminalId: "terminal-child", version: "1.3.1" };
			},
		}),
		resolveInvocation: (args) => ({ command: "/bin/pi", args }),
		createLauncher: async () => ({
			path: "/tmp/pi-fleet-spawn-test/launch.sh",
			command: "/tmp/pi-fleet-spawn-test/launch.sh",
			cleanup: async () => {
				launcherCleaned = true;
			},
		}),
		realpath: async (value) => `/real${value}`,
		isDirectory: async () => true,
		now: () => now,
		randomId: (prefix) => `${prefix}_1234567890abcdef`,
		sleep: async () => {
			now += 101;
		},
		launchTimeoutMs: 200,
		environment: {},
	};
	return {
		mock,
		deps,
		transports,
		splitCalls,
		get launcherCleaned() {
			return launcherCleaned;
		},
		get cleanupStateAtFirstPoll() {
			return cleanupStateAtFirstPoll;
		},
	};
}

test("spawn auto-creates a group, preserves parent, inherits model, and sends kickoff", async () => {
	const runtime = harness();
	const { mock, deps, transports, splitCalls } = runtime;
	const controller = new FleetController(mock.pi, deps);
	let confirmations = 0;
	const context = createMockContext({
		mode: "tui",
		hasUI: true,
		cwd: "/project",
		model: { provider: "provider", id: "model" },
		thinkingLevel: "high",
		confirm: async () => {
			confirmations += 1;
			return true;
		},
	});
	await controller.sessionStart({ reason: "startup" }, context.ctx);
	const result = await controller.spawn(context.ctx, {
		direction: "down",
		name: "Child",
		task: "Check tests",
		cwd: "worktree",
	});
	assert.equal(confirmations, 2);
	assert.equal(transports.length, 1);
	assert.equal(splitCalls.length, 1);
	assert.equal(splitCalls[0]?.direction, "down");
	assert.equal(runtime.cleanupStateAtFirstPoll, false);
	assert.equal(splitCalls[0]?.cwd, "/real/project/worktree");
	assert.equal(splitCalls[0]?.environment.PI_FLEET_MODEL_PROVIDER, "provider");
	assert.equal(splitCalls[0]?.environment.PI_FLEET_MODEL_ID, "model");
	assert.equal(splitCalls[0]?.environment.PI_FLEET_THINKING, "high");
	assert.match(splitCalls[0]?.environment.PI_FLEET_INVITE ?? "", /^pifleet:v1:/u);
	assert.equal(transports[0]?.messages[0]?.mode, "kickoff");
	assert.equal(transports[0]?.messages[0]?.text, "Check tests");
	assert.equal(result.sessionId, "child-session");
	assert.equal(result.kickoffAccepted, true);
	assert.equal(runtime.launcherCleaned, true);
	assert.equal(mock.sentMessages.length, 0);
	await controller.sessionShutdown({ reason: "quit" }, context.ctx);
});

test("spawn reuses an existing group and supports all split directions", async () => {
	for (const direction of ["right", "down", "left", "up"] as const) {
		const { mock, deps, transports, splitCalls } = harness();
		const controller = new FleetController(mock.pi, deps);
		const context = createMockContext({ mode: "rpc", hasUI: true, confirm: async () => true });
		await controller.sessionStart({ reason: "startup" }, context.ctx);
		await controller.startNewGroup(context.ctx, false);
		await controller.spawn(context.ctx, { direction });
		assert.equal(transports.length, 1);
		assert.equal(splitCalls[0]?.direction, direction);
		await controller.sessionShutdown({ reason: "quit" }, context.ctx);
	}
});

test("spawn rejects an overlong canonical cwd before side effects", async () => {
	const { mock, deps, transports, splitCalls } = harness();
	const controller = new FleetController(mock.pi, deps);
	const context = createMockContext({ mode: "tui", hasUI: true, confirm: async () => true });
	await controller.sessionStart({ reason: "startup" }, context.ctx);
	await assert.rejects(controller.spawn(context.ctx, { cwd: "x".repeat(5_000) }), /cwd/u);
	assert.equal(transports.length, 0);
	assert.equal(splitCalls.length, 0);
	await controller.sessionShutdown({ reason: "quit" }, context.ctx);
});

test("spawn rejects unsupported modes and cancellation before side effects", async () => {
	const firstHarness = harness();
	const first = new FleetController(firstHarness.mock.pi, firstHarness.deps);
	const json = createMockContext({ mode: "json", hasUI: false });
	await first.sessionStart({ reason: "startup" }, json.ctx);
	await assert.rejects(first.spawn(json.ctx, {}), /TUI or RPC/u);
	assert.equal(firstHarness.transports.length, 0);
	assert.equal(firstHarness.splitCalls.length, 0);
	await first.sessionShutdown({ reason: "quit" }, json.ctx);

	const secondHarness = harness();
	const second = new FleetController(secondHarness.mock.pi, secondHarness.deps);
	const cancelled = createMockContext({ mode: "tui", hasUI: true, confirm: async () => false });
	await second.sessionStart({ reason: "startup" }, cancelled.ctx);
	await assert.rejects(second.spawn(cancelled.ctx, {}), /cancelled/u);
	assert.equal(secondHarness.transports.length, 0);
	assert.equal(secondHarness.splitCalls.length, 0);
	await second.sessionShutdown({ reason: "quit" }, cancelled.ctx);
});

test("session shutdown waits for an in-flight launch to release its launcher", async () => {
	const runtime = harness({ ready: false });
	let signalSleepEntered!: () => void;
	const sleepEntered = new Promise<void>((resolve) => {
		signalSleepEntered = resolve;
	});
	runtime.deps.sleep = async (_milliseconds, signal) => {
		signalSleepEntered();
		await new Promise<void>((_resolve, reject) => {
			const abort = () => reject(new Error("launch wait aborted"));
			signal?.addEventListener("abort", abort, { once: true });
			if (signal?.aborted) abort();
		});
	};
	let releaseCleanup!: () => void;
	let signalCleanupStarted!: () => void;
	const cleanupStarted = new Promise<void>((resolve) => {
		signalCleanupStarted = resolve;
	});
	const cleanupReleased = new Promise<void>((resolve) => {
		releaseCleanup = resolve;
	});
	runtime.deps.createLauncher = async () => ({
		path: "/tmp/pi-fleet-test/launch.sh",
		command: "/tmp/pi-fleet-test/launch.sh",
		cleanup: async () => {
			signalCleanupStarted();
			await cleanupReleased;
		},
	});
	const controller = new FleetController(runtime.mock.pi, runtime.deps);
	const context = createMockContext({ mode: "tui", hasUI: true, confirm: async () => true });
	await controller.sessionStart({ reason: "startup" }, context.ctx);
	const spawning = controller.spawn(context.ctx, {});
	await sleepEntered;
	let shutdownResolved = false;
	const shuttingDown = controller.sessionShutdown({ reason: "quit" }, context.ctx).then(() => {
		shutdownResolved = true;
	});
	await cleanupStarted;
	const shutdownState = await Promise.race([
		shuttingDown.then(() => "resolved" as const),
		new Promise<"pending">((resolve) => setImmediate(() => resolve("pending"))),
	]);
	assert.equal(shutdownState, "pending");
	assert.equal(shutdownResolved, false);
	releaseCleanup();
	await assert.rejects(spawning, /split|ready|aborted/u);
	await shuttingDown;
	assert.equal(context.statuses.get("fleet"), undefined);
});

test("pre-split failure rolls back an automatic group while readiness timeout keeps it", async () => {
	const failedHarness = harness({ ghosttyError: new GhosttyLaunchError("denied", false) });
	const failed = new FleetController(failedHarness.mock.pi, failedHarness.deps);
	const firstContext = createMockContext({ mode: "tui", hasUI: true, confirm: async () => true });
	await failed.sessionStart({ reason: "startup" }, firstContext.ctx);
	await assert.rejects(failed.spawn(firstContext.ctx, {}), /denied/u);
	assert.equal(failedHarness.transports[0]?.stopped, 1);
	assert.equal(failedHarness.launcherCleaned, true);
	assert.equal((await failed.snapshot()).connected, false);
	await failed.sessionShutdown({ reason: "quit" }, firstContext.ctx);

	const timeoutHarness = harness({ ready: false });
	const timeout = new FleetController(timeoutHarness.mock.pi, timeoutHarness.deps);
	const secondContext = createMockContext({ mode: "tui", hasUI: true, confirm: async () => true });
	await timeout.sessionStart({ reason: "startup" }, secondContext.ctx);
	await assert.rejects(
		timeout.spawn(secondContext.ctx, {}),
		(error: unknown) => error instanceof GhosttyLaunchError && error.splitCreated,
	);
	assert.equal(timeoutHarness.launcherCleaned, true);
	assert.equal((await timeout.snapshot()).connected, true);
	await timeout.sessionShutdown({ reason: "quit" }, secondContext.ctx);
});
