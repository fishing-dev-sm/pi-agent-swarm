import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { createGroup, type FleetMessage } from "../src/protocol.js";
import { FleetTransport } from "../src/transport.js";

const posixTest = process.platform === "win32" ? test.skip : test;
const NOW = Date.now();

async function fixture(run: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp("/tmp/pi-fleet-transport-test-");
	try {
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

function fleetMessage(
	id: string,
	fromSessionId: string,
	toSessionId: string,
	mode: FleetMessage["mode"] = "notify",
): FleetMessage {
	return {
		id,
		fromSessionId,
		toSessionId,
		mode,
		text: `${mode} from ${fromSessionId}`,
		issuedAt: NOW,
	};
}

posixTest("two transports discover, authenticate, deduplicate, and clean up", async () => {
	await fixture(async (baseDirectory) => {
		const group = createGroup(Buffer.alloc(32, 8));
		const received: FleetMessage[] = [];
		const first = new FleetTransport({
			group,
			peer: {
				protocolVersion: 1,
				sessionId: "first",
				name: "First\u001b[31m",
				cwd: "/tmp/first",
				pid: process.pid,
				acceptsRequests: true,
			},
			baseDirectory,
			onMessage: async (message) => {
				received.push(message);
			},
		});
		const second = new FleetTransport({
			group,
			peer: {
				protocolVersion: 1,
				sessionId: "second",
				name: "Second",
				cwd: "/tmp/second",
				pid: process.pid,
				acceptsRequests: false,
			},
			baseDirectory,
			onMessage: async (message) => {
				received.push(message);
			},
		});
		await first.start();
		await second.start();
		const peers = await first.listPeers();
		assert.deepEqual(
			peers.map((peer) => peer.sessionId),
			["second"],
		);
		const outbound = fleetMessage("msg_notify_123456", "first", "second");
		assert.deepEqual(await first.send("second", outbound), {
			accepted: true,
			duplicate: false,
		});
		assert.deepEqual(await first.send("second", outbound), {
			accepted: true,
			duplicate: true,
		});
		assert.equal(received.length, 1);
		assert.deepEqual(
			await first.send("second", fleetMessage("msg_request_12345", "first", "second", "request")),
			{
				accepted: false,
				duplicate: false,
				error: "Target session does not allow agent requests",
			},
		);
		assert.equal(received.length, 1);
		const manifest = first.endpointManifest;
		assert.ok(manifest);
		assert.equal((await stat(manifest.manifestPath)).mode & 0o777, 0o600);
		assert.equal((await stat(manifest.socketPath)).mode & 0o777, 0o600);
		await Promise.all([first.stop(), second.stop(), first.stop()]);
		await assert.rejects(readFile(manifest.manifestPath, "utf8"));
	});
});

posixTest("launch kickoff is accepted once only for the matching launch id", async () => {
	await fixture(async (baseDirectory) => {
		const group = createGroup(Buffer.alloc(32, 9));
		const received: FleetMessage[] = [];
		const parent = new FleetTransport({
			group,
			peer: {
				protocolVersion: 1,
				sessionId: "parent",
				cwd: "/tmp",
				pid: process.pid,
				acceptsRequests: false,
			},
			baseDirectory,
			onMessage: async () => undefined,
		});
		const child = new FleetTransport({
			group,
			peer: {
				protocolVersion: 1,
				sessionId: "child",
				cwd: "/tmp",
				pid: process.pid,
				launchId: "launch_1234567890",
				acceptsRequests: false,
			},
			baseDirectory,
			onMessage: async (value) => {
				received.push(value);
			},
		});
		await parent.start();
		await child.start();
		const wrong = {
			...fleetMessage("msg_kickoff_wrong1", "parent", "child", "kickoff"),
			launchId: "launch_wrong1234",
		};
		assert.equal((await parent.send("child", wrong)).accepted, false);
		const kickoff = {
			...fleetMessage("msg_kickoff_right1", "parent", "child", "kickoff"),
			launchId: "launch_1234567890",
		};
		assert.equal((await parent.send("child", kickoff)).accepted, true);
		assert.equal(
			(await parent.send("child", { ...kickoff, id: "msg_kickoff_right2" })).accepted,
			false,
		);
		assert.equal(received.length, 1);
		await Promise.all([parent.stop(), child.stop()]);
	});
});

posixTest("failed delivery can be retried without becoming a false duplicate", async () => {
	await fixture(async (baseDirectory) => {
		const group = createGroup(Buffer.alloc(32, 12));
		let deliveryAttempts = 0;
		const sender = new FleetTransport({
			group,
			peer: {
				protocolVersion: 1,
				sessionId: "retry-sender",
				cwd: "/tmp",
				pid: process.pid,
				acceptsRequests: false,
			},
			baseDirectory,
			onMessage: async () => undefined,
		});
		const receiver = new FleetTransport({
			group,
			peer: {
				protocolVersion: 1,
				sessionId: "retry-receiver",
				cwd: "/tmp",
				pid: process.pid,
				acceptsRequests: false,
			},
			baseDirectory,
			onMessage: async () => {
				deliveryAttempts += 1;
				if (deliveryAttempts === 1) throw new Error("temporary rejection");
			},
		});
		await Promise.all([sender.start(), receiver.start()]);
		const message = fleetMessage("msg_retry_12345678", "retry-sender", "retry-receiver");
		assert.deepEqual(await sender.send("retry-receiver", message), {
			accepted: false,
			duplicate: false,
			error: "Target session rejected the message",
		});
		assert.deepEqual(await sender.send("retry-receiver", message), {
			accepted: true,
			duplicate: false,
		});
		assert.equal(deliveryAttempts, 2);
		await Promise.all([sender.stop(), receiver.stop()]);
	});
});

posixTest("only one concurrent launch kickoff can enter the child session", async () => {
	await fixture(async (baseDirectory) => {
		const group = createGroup(Buffer.alloc(32, 13));
		let releaseDelivery!: () => void;
		let signalDeliveryStarted!: () => void;
		let deliveries = 0;
		const deliveryStarted = new Promise<void>((resolve) => {
			signalDeliveryStarted = resolve;
		});
		const deliveryReleased = new Promise<void>((resolve) => {
			releaseDelivery = resolve;
		});
		const parent = new FleetTransport({
			group,
			peer: {
				protocolVersion: 1,
				sessionId: "concurrent-parent",
				cwd: "/tmp",
				pid: process.pid,
				acceptsRequests: false,
			},
			baseDirectory,
			onMessage: async () => undefined,
		});
		const child = new FleetTransport({
			group,
			peer: {
				protocolVersion: 1,
				sessionId: "concurrent-child",
				cwd: "/tmp",
				pid: process.pid,
				launchId: "launch_concurrent1",
				acceptsRequests: false,
			},
			baseDirectory,
			onMessage: async () => {
				deliveries += 1;
				if (deliveries === 1) {
					signalDeliveryStarted();
					await deliveryReleased;
				}
			},
		});
		await Promise.all([parent.start(), child.start()]);
		const first = parent.send("concurrent-child", {
			...fleetMessage("msg_concurrent_first", "concurrent-parent", "concurrent-child", "kickoff"),
			launchId: "launch_concurrent1",
		});
		await deliveryStarted;
		const second = await parent.send("concurrent-child", {
			...fleetMessage("msg_concurrent_second", "concurrent-parent", "concurrent-child", "kickoff"),
			launchId: "launch_concurrent1",
		});
		releaseDelivery();
		const firstAck = await first;
		await Promise.all([parent.stop(), child.stop()]);
		assert.deepEqual(second, {
			accepted: false,
			duplicate: false,
			error: "Launch kickoff has already been consumed",
		});
		assert.equal(firstAck.accepted, true);
		assert.equal(deliveries, 1);
	});
});

posixTest("discovery ignores sockets with non-private permissions", async () => {
	await fixture(async (baseDirectory) => {
		const group = createGroup(Buffer.alloc(32, 14));
		const first = new FleetTransport({
			group,
			peer: {
				protocolVersion: 1,
				sessionId: "private-first",
				cwd: "/tmp",
				pid: process.pid,
				acceptsRequests: false,
			},
			baseDirectory,
			onMessage: async () => undefined,
		});
		const second = new FleetTransport({
			group,
			peer: {
				protocolVersion: 1,
				sessionId: "private-second",
				cwd: "/tmp",
				pid: process.pid,
				acceptsRequests: false,
			},
			baseDirectory,
			onMessage: async () => undefined,
		});
		await Promise.all([first.start(), second.start()]);
		const endpoint = second.endpointManifest;
		assert.ok(endpoint);
		await chmod(endpoint.manifestPath, 0o644);
		assert.deepEqual(await first.listPeers(), []);
		await chmod(endpoint.manifestPath, 0o600);
		await chmod(endpoint.socketPath, 0o666);
		assert.deepEqual(await first.listPeers(), []);
		await Promise.all([first.stop(), second.stop()]);
	});
});

posixTest("stale manifests are removed only after a failed authenticated probe", async () => {
	await fixture(async (baseDirectory) => {
		const group = createGroup(Buffer.alloc(32, 10));
		const transport = new FleetTransport({
			group,
			peer: {
				protocolVersion: 1,
				sessionId: "live",
				cwd: "/tmp",
				pid: process.pid,
				acceptsRequests: false,
			},
			baseDirectory,
			onMessage: async () => undefined,
		});
		await transport.start();
		const endpoint = transport.endpointManifest;
		assert.ok(endpoint);
		const stalePath = join(endpoint.directory, "stale12345678.json");
		await writeFile(
			stalePath,
			JSON.stringify({
				protocolVersion: 1,
				sessionId: "stale",
				endpointPath: join(endpoint.directory, "stale12345678.sock"),
				pid: 999999,
			}),
			{ mode: 0o600 },
		);
		assert.deepEqual(await transport.listPeers(), []);
		await assert.rejects(readFile(stalePath, "utf8"));
		await transport.stop();
	});
});

posixTest("aborted discovery and sends stop promptly", async () => {
	await fixture(async (baseDirectory) => {
		const group = createGroup(Buffer.alloc(32, 11));
		const transport = new FleetTransport({
			group,
			peer: {
				protocolVersion: 1,
				sessionId: "only",
				cwd: "/tmp",
				pid: process.pid,
				acceptsRequests: false,
			},
			baseDirectory,
			onMessage: async () => undefined,
		});
		await transport.start();
		const controller = new AbortController();
		controller.abort();
		await assert.rejects(transport.listPeers(controller.signal), /aborted/u);
		await assert.rejects(
			transport.send(
				"missing",
				fleetMessage("msg_missing_123456", "only", "missing"),
				controller.signal,
			),
			/aborted/u,
		);
		await transport.stop();
	});
});
