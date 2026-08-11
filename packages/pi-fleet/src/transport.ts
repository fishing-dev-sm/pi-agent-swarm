import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, open, readdir, readFile, rm } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { basename, dirname, resolve } from "node:path";
import {
	createSignedFrame,
	FixedWindowRateLimiter,
	FLEET_PROTOCOL_VERSION,
	type FleetGroup,
	type FleetMessage,
	type FleetPeerDescription,
	JsonLineDecoder,
	MAX_FRAME_BYTES,
	ReplayWindow,
	type SignedFleetFrame,
	validateMessage,
	validatePeerDescription,
	verifySignedFrame,
} from "./protocol.js";
import {
	assertOwnedPath,
	createEndpointPaths,
	type EndpointManifest,
	type EndpointPaths,
	ensureGroupRuntimeDirectory,
	MAX_MANIFEST_BYTES,
	publishManifest,
	randomEndpointId,
	removeOwnedEndpoint,
} from "./runtime-directory.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 2_000;
const MAX_DISCOVERY_MANIFESTS = 64;
const MAX_PENDING_CONNECTIONS = 32;
const MESSAGE_DEDUP_CAPACITY = 1_024;
const MESSAGE_DEDUP_TTL_MS = 10 * 60_000;
const FRAME_REPLAY_CAPACITY = 2_048;
const FRAME_REPLAY_TTL_MS = 2 * 60_000;
const MAX_REQUESTS_PER_MINUTE = 60;
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const SAFE_ENDPOINT_SOCKET = /^[A-Za-z0-9_-]{8,64}\.sock$/u;

export interface FleetTransportOptions {
	group: FleetGroup;
	peer: FleetPeerDescription;
	baseDirectory?: string;
	requestTimeoutMs?: number;
	onMessage(message: FleetMessage): Promise<void> | void;
	seenMessageIds?: readonly string[];
	kickoffConsumed?: boolean;
	now?: () => number;
}

export interface FleetDeliveryAck {
	accepted: boolean;
	duplicate: boolean;
	error?: string;
}

interface ManifestRecord {
	manifest: EndpointManifest;
	manifestPath: string;
	raw: string;
	socketIdentity?: { dev: bigint; ino: bigint };
}

export class FleetTransport {
	private server?: Server;
	private paths?: EndpointPaths;
	private startPromise?: Promise<void>;
	private stopPromise?: Promise<void>;
	private stopped = false;
	private readonly lifecycle = new AbortController();
	private readonly sockets = new Set<Socket>();
	private readonly pendingTasks = new Set<Promise<void>>();
	private readonly frameReplay = new ReplayWindow(FRAME_REPLAY_CAPACITY, FRAME_REPLAY_TTL_MS);
	private readonly responseReplay = new ReplayWindow(FRAME_REPLAY_CAPACITY, FRAME_REPLAY_TTL_MS);
	private readonly messageDedup = new ReplayWindow(MESSAGE_DEDUP_CAPACITY, MESSAGE_DEDUP_TTL_MS);
	private readonly rateLimiter = new FixedWindowRateLimiter(
		MAX_REQUESTS_PER_MINUTE,
		60_000,
		MAX_DISCOVERY_MANIFESTS,
	);
	private kickoffConsumed = false;
	private kickoffPending = false;
	private readonly pendingMessageIds = new Set<string>();
	private readonly now: () => number;

	constructor(private readonly options: FleetTransportOptions) {
		if (process.platform === "win32") {
			throw new Error("Pi Fleet local transport requires a POSIX platform");
		}
		if (options.group.secret.length !== 32) throw new Error("Pi Fleet group secret is invalid");
		if (!SAFE_SESSION_ID.test(options.peer.sessionId)) {
			throw new Error("Pi Fleet local session id is invalid");
		}
		if (options.peer.protocolVersion !== FLEET_PROTOCOL_VERSION) {
			throw new Error("Pi Fleet local protocol version is invalid");
		}
		validatePeerDescription(options.peer);
		this.now = options.now ?? Date.now;
		this.kickoffConsumed = options.kickoffConsumed === true;
		for (const id of options.seenMessageIds ?? []) {
			if (SAFE_SESSION_ID.test(id)) this.messageDedup.accept(id, this.now());
		}
	}

	setAcceptsRequests(value: boolean): void {
		this.options.peer.acceptsRequests = value;
	}

	get peerDescription(): FleetPeerDescription {
		return { ...this.options.peer };
	}

	get endpointManifest(): (EndpointPaths & { peer: FleetPeerDescription }) | undefined {
		return this.paths ? { ...this.paths, peer: { ...this.options.peer } } : undefined;
	}

	async start(signal?: AbortSignal): Promise<void> {
		if (this.stopped) throw new Error("Pi Fleet transport has already stopped");
		if (this.startPromise) return this.startPromise;
		throwIfAborted(signal, "Pi Fleet transport start aborted");
		const operationSignal = combineSignals(signal, this.lifecycle.signal);
		this.startPromise = this.startOwned(operationSignal).catch(async (error) => {
			await this.cleanup();
			this.startPromise = undefined;
			throw error;
		});
		return this.startPromise;
	}

	async listPeers(signal?: AbortSignal): Promise<FleetPeerDescription[]> {
		this.assertStarted();
		throwIfAborted(signal, "Pi Fleet peer discovery aborted");
		const manifests = await this.readManifests(signal);
		const peers: FleetPeerDescription[] = [];
		for (const record of manifests) {
			throwIfAborted(signal, "Pi Fleet peer discovery aborted");
			if (record.manifest.sessionId === this.options.peer.sessionId) continue;
			try {
				const response = await this.request(
					record,
					record.manifest.sessionId,
					{ kind: "describe" },
					signal,
				);
				if (response.payload.kind !== "description") {
					throw new Error("Pi Fleet peer returned an invalid description response");
				}
				if (response.payload.peer.sessionId !== record.manifest.sessionId) {
					throw new Error("Pi Fleet peer identity does not match its endpoint manifest");
				}
				peers.push(response.payload.peer);
			} catch (error) {
				if (isAbortError(error)) throw error;
				if (isDeadEndpointError(error)) await this.removeStaleRecord(record);
			}
		}
		throwIfAborted(signal, "Pi Fleet peer discovery aborted");
		return peers.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
	}

	async send(
		targetSessionId: string,
		value: FleetMessage,
		signal?: AbortSignal,
	): Promise<FleetDeliveryAck> {
		this.assertStarted();
		throwIfAborted(signal, "Pi Fleet message send aborted");
		if (!SAFE_SESSION_ID.test(targetSessionId))
			throw new Error("Pi Fleet target session id is invalid");
		const message = validateMessage(value);
		if (message.fromSessionId !== this.options.peer.sessionId) {
			throw new Error("Pi Fleet message sender does not match the local session");
		}
		if (message.toSessionId !== targetSessionId) {
			throw new Error("Pi Fleet message target does not match the selected session");
		}
		const manifests = await this.readManifests(signal);
		throwIfAborted(signal, "Pi Fleet message send aborted");
		const record = manifests.find(({ manifest }) => manifest.sessionId === targetSessionId);
		if (!record) throw new Error(`Pi Fleet session ${targetSessionId} is unavailable`);
		const response = await this.request(
			record,
			targetSessionId,
			{ kind: "message", message },
			signal,
		);
		if (response.payload.kind !== "ack") {
			throw new Error("Pi Fleet peer returned an invalid delivery acknowledgement");
		}
		return {
			accepted: response.payload.accepted,
			duplicate: response.payload.duplicate === true,
			...(response.payload.error ? { error: response.payload.error } : {}),
		};
	}

	async stop(): Promise<void> {
		if (this.stopPromise) return this.stopPromise;
		this.stopped = true;
		this.lifecycle.abort();
		const start = this.startPromise;
		this.stopPromise = (async () => {
			await start?.catch(() => undefined);
			await this.cleanup();
		})();
		return this.stopPromise;
	}

	private async startOwned(signal?: AbortSignal): Promise<void> {
		const directory = await ensureGroupRuntimeDirectory(this.options.group.id, {
			...(this.options.baseDirectory ? { baseDirectory: this.options.baseDirectory } : {}),
		});
		throwIfAborted(signal, "Pi Fleet transport start aborted");
		const paths = createEndpointPaths(directory, randomEndpointId());
		await removeOwnedEndpoint(paths);
		const server = createServer((socket) => this.acceptSocket(socket));
		this.server = server;
		this.paths = paths;
		await listen(server, paths.socketPath, signal);
		await chmod(paths.socketPath, 0o600);
		throwIfAborted(signal, "Pi Fleet transport start aborted");
		await publishManifest(paths.manifestPath, {
			protocolVersion: FLEET_PROTOCOL_VERSION,
			sessionId: this.options.peer.sessionId,
			endpointPath: paths.socketPath,
			pid: this.options.peer.pid,
		});
		throwIfAborted(signal, "Pi Fleet transport start aborted");
	}

	private acceptSocket(socket: Socket): void {
		if (this.stopped || this.sockets.size >= MAX_PENDING_CONNECTIONS) {
			socket.destroy();
			return;
		}
		this.sockets.add(socket);
		socket.setTimeout(this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, () =>
			socket.destroy(),
		);
		let handled = false;
		const decoder = new JsonLineDecoder({
			onValue: (value) => {
				if (handled) {
					socket.destroy();
					return;
				}
				handled = true;
				const task = this.handleIncoming(socket, value);
				this.pendingTasks.add(task);
				void task.then(
					() => this.pendingTasks.delete(task),
					() => this.pendingTasks.delete(task),
				);
			},
			onError: () => socket.destroy(),
		});
		socket.on("data", (chunk) =>
			decoder.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk),
		);
		socket.on("end", () => decoder.finish());
		socket.on("error", () => undefined);
		socket.on("close", () => this.sockets.delete(socket));
	}

	private async handleIncoming(socket: Socket, value: unknown): Promise<void> {
		try {
			const frame = verifySignedFrame(value, this.options.group.secret, {
				expectedGroupId: this.options.group.id,
				expectedTargetSessionId: this.options.peer.sessionId,
				now: this.now(),
				replay: this.frameReplay,
			});
			if (!this.rateLimiter.accept(frame.senderSessionId, this.now())) {
				await this.respond(socket, frame, {
					kind: "ack",
					accepted: false,
					error: "Target session rate limit exceeded",
				});
				return;
			}
			if (frame.payload.kind === "describe") {
				await this.respond(socket, frame, { kind: "description", peer: this.options.peer });
				return;
			}
			if (frame.payload.kind !== "message") throw new Error("Unsupported Pi Fleet request payload");
			const message = frame.payload.message;
			if (
				message.fromSessionId !== frame.senderSessionId ||
				message.toSessionId !== this.options.peer.sessionId
			) {
				throw new Error("Pi Fleet message identity does not match its authenticated frame");
			}
			const duplicate = this.messageDedup.has(message.id, this.now());
			if (duplicate) {
				await this.respond(socket, frame, { kind: "ack", accepted: true, duplicate: true });
				return;
			}
			const policyError = this.messagePolicyError(message);
			if (policyError) {
				await this.respond(socket, frame, {
					kind: "ack",
					accepted: false,
					error: policyError,
				});
				return;
			}
			if (this.pendingMessageIds.has(message.id)) {
				await this.respond(socket, frame, {
					kind: "ack",
					accepted: false,
					error: "Target session is still delivering this message",
				});
				return;
			}
			this.pendingMessageIds.add(message.id);
			if (message.mode === "kickoff") this.kickoffPending = true;
			try {
				await this.options.onMessage(message);
				this.messageDedup.record(message.id, this.now());
				if (message.mode === "kickoff") this.kickoffConsumed = true;
			} catch {
				await this.respond(socket, frame, {
					kind: "ack",
					accepted: false,
					error: "Target session rejected the message",
				});
				return;
			} finally {
				this.pendingMessageIds.delete(message.id);
				if (message.mode === "kickoff") this.kickoffPending = false;
			}
			await this.respond(socket, frame, { kind: "ack", accepted: true, duplicate: false });
		} catch {
			socket.destroy();
		}
	}

	private messagePolicyError(message: FleetMessage): string | undefined {
		if (message.mode === "request" && !this.options.peer.acceptsRequests) {
			return "Target session does not allow agent requests";
		}
		if (message.mode === "kickoff") {
			if (!this.options.peer.launchId || message.launchId !== this.options.peer.launchId) {
				return "Launch kickoff does not match the target session";
			}
			if (this.kickoffConsumed || this.kickoffPending) {
				return "Launch kickoff has already been consumed";
			}
		}
		return undefined;
	}

	private async respond(
		socket: Socket,
		request: SignedFleetFrame,
		payload: SignedFleetFrame["payload"],
	): Promise<void> {
		const response = createSignedFrame(
			{
				groupId: this.options.group.id,
				requestId: request.requestId,
				targetSessionId: request.senderSessionId,
				senderSessionId: this.options.peer.sessionId,
				issuedAt: this.now(),
				nonce: randomId("nonce"),
				payload,
			},
			this.options.group.secret,
		);
		await writeFrame(socket, response);
		socket.end();
	}

	private async readManifests(signal?: AbortSignal): Promise<ManifestRecord[]> {
		const paths = this.paths;
		if (!paths) throw new Error("Pi Fleet transport is not started");
		throwIfAborted(signal, "Pi Fleet peer discovery aborted");
		const entries = (await readdir(paths.directory, { withFileTypes: true }))
			.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
			.sort((left, right) => left.name.localeCompare(right.name))
			.slice(0, MAX_DISCOVERY_MANIFESTS);
		const records: ManifestRecord[] = [];
		for (const entry of entries) {
			throwIfAborted(signal, "Pi Fleet peer discovery aborted");
			try {
				records.push(await readManifest(paths.directory, resolve(paths.directory, entry.name)));
			} catch {
				// Untrusted or concurrently removed manifests are ignored.
			}
		}
		throwIfAborted(signal, "Pi Fleet peer discovery aborted");
		return records;
	}

	private async request(
		record: ManifestRecord,
		targetSessionId: string,
		payload: SignedFleetFrame["payload"],
		signal?: AbortSignal,
	): Promise<SignedFleetFrame> {
		throwIfAborted(signal, "Pi Fleet request aborted");
		const requestId = randomId("req");
		const frame = createSignedFrame(
			{
				groupId: this.options.group.id,
				requestId,
				targetSessionId,
				senderSessionId: this.options.peer.sessionId,
				issuedAt: this.now(),
				nonce: randomId("nonce"),
				payload,
			},
			this.options.group.secret,
		);
		const value = await requestFrame(
			record.manifest.endpointPath,
			frame,
			signal,
			this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
		);
		throwIfAborted(signal, "Pi Fleet request aborted");
		const response = verifySignedFrame(value, this.options.group.secret, {
			expectedGroupId: this.options.group.id,
			expectedTargetSessionId: this.options.peer.sessionId,
			now: this.now(),
			replay: this.responseReplay,
		});
		if (response.requestId !== requestId || response.senderSessionId !== targetSessionId) {
			throw new Error("Pi Fleet response identity does not match its request");
		}
		return response;
	}

	private async removeStaleRecord(record: ManifestRecord): Promise<void> {
		try {
			const current = await readFile(record.manifestPath, "utf8");
			if (current !== record.raw) return;
			await rm(record.manifestPath, { force: true });
			if (record.socketIdentity) {
				const info = await lstat(record.manifest.endpointPath).catch(() => undefined);
				if (
					info?.isSocket() &&
					BigInt(info.dev) === record.socketIdentity.dev &&
					BigInt(info.ino) === record.socketIdentity.ino
				) {
					await rm(record.manifest.endpointPath, { force: true });
				}
			}
		} catch {
			// A concurrent owner change wins over stale cleanup.
		}
	}

	private assertStarted(): void {
		if (!this.startPromise || !this.paths || this.stopped) {
			throw new Error("Pi Fleet transport is not started");
		}
	}

	private async cleanup(): Promise<void> {
		const server = this.server;
		this.server = undefined;
		for (const socket of this.sockets) socket.destroy();
		this.sockets.clear();
		if (server) await closeServer(server);
		await Promise.allSettled([...this.pendingTasks]);
		this.pendingTasks.clear();
		this.pendingMessageIds.clear();
		this.kickoffPending = false;
		if (this.paths) await removeOwnedEndpoint(this.paths);
		this.paths = undefined;
	}
}

async function readManifest(directory: string, manifestPath: string): Promise<ManifestRecord> {
	assertOwnedPath(directory, manifestPath, ".json");
	const handle = await open(manifestPath, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const info = await handle.stat({ bigint: true });
		if (!info.isFile() || info.size > BigInt(MAX_MANIFEST_BYTES)) {
			throw new Error("Pi Fleet endpoint manifest is invalid");
		}
		if (typeof process.getuid === "function" && Number(info.uid) !== process.getuid()) {
			throw new Error("Pi Fleet endpoint manifest has another owner");
		}
		if ((Number(info.mode) & 0o777) !== 0o600) {
			throw new Error("Pi Fleet endpoint manifest permissions are not private");
		}
		const raw = await handle.readFile("utf8");
		const value = JSON.parse(raw) as unknown;
		if (!isRecord(value)) throw new Error("Pi Fleet endpoint manifest is invalid");
		if (value.protocolVersion !== FLEET_PROTOCOL_VERSION) {
			throw new Error("Pi Fleet endpoint protocol version is unsupported");
		}
		if (typeof value.sessionId !== "string" || !SAFE_SESSION_ID.test(value.sessionId)) {
			throw new Error("Pi Fleet endpoint session id is invalid");
		}
		if (
			typeof value.endpointPath !== "string" ||
			dirname(resolve(value.endpointPath)) !== resolve(directory) ||
			!SAFE_ENDPOINT_SOCKET.test(basename(value.endpointPath))
		) {
			throw new Error("Pi Fleet endpoint socket path is invalid");
		}
		if (typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid < 1) {
			throw new Error("Pi Fleet endpoint process id is invalid");
		}
		const socketInfo = await lstat(value.endpointPath).catch(() => undefined);
		if (socketInfo) {
			if (!socketInfo.isSocket()) {
				throw new Error("Pi Fleet endpoint path is not a Unix socket");
			}
			if (typeof process.getuid === "function" && socketInfo.uid !== process.getuid()) {
				throw new Error("Pi Fleet endpoint socket has another owner");
			}
			if ((socketInfo.mode & 0o777) !== 0o600) {
				throw new Error("Pi Fleet endpoint socket permissions are not private");
			}
		}
		return {
			manifest: {
				protocolVersion: FLEET_PROTOCOL_VERSION,
				sessionId: value.sessionId,
				endpointPath: value.endpointPath,
				pid: value.pid,
			},
			manifestPath,
			raw,
			...(socketInfo
				? { socketIdentity: { dev: BigInt(socketInfo.dev), ino: BigInt(socketInfo.ino) } }
				: {}),
		};
	} finally {
		await handle.close();
	}
}

function requestFrame(
	endpointPath: string,
	frame: SignedFleetFrame,
	signal: AbortSignal | undefined,
	timeoutMs: number,
): Promise<unknown> {
	return new Promise((resolvePromise, rejectPromise) => {
		let settled = false;
		let received = false;
		const socket = createConnection(endpointPath);
		const finish = (error?: Error, value?: unknown) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			socket.destroy();
			if (error) rejectPromise(error);
			else resolvePromise(value);
		};
		const decoder = new JsonLineDecoder({
			onValue: (value) => {
				if (received) {
					finish(new Error("Pi Fleet peer returned multiple response frames"));
					return;
				}
				received = true;
				finish(undefined, value);
			},
			onError: (error) => finish(error),
		});
		const timer = setTimeout(
			() => finish(new FleetEndpointError("ETIMEDOUT", "Pi Fleet request timed out")),
			timeoutMs,
		);
		timer.unref();
		const onAbort = () => finish(abortError("Pi Fleet request aborted"));
		signal?.addEventListener("abort", onAbort, { once: true });
		socket.once("connect", () => {
			void writeFrame(socket, frame).catch((error) =>
				finish(error instanceof Error ? error : new Error(String(error))),
			);
		});
		socket.on("data", (chunk) =>
			decoder.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk),
		);
		socket.once("error", (error: NodeJS.ErrnoException) => {
			finish(
				new FleetEndpointError(
					error.code ?? "EIO",
					`Pi Fleet endpoint failed: ${error.code ?? "I/O error"}`,
				),
			);
		});
		socket.once("close", () => {
			if (!settled)
				finish(new FleetEndpointError("ECONNRESET", "Pi Fleet endpoint closed without a response"));
		});
		if (signal?.aborted) onAbort();
	});
}

async function writeFrame(socket: Socket, frame: SignedFleetFrame): Promise<void> {
	const data = Buffer.from(`${JSON.stringify(frame)}\n`, "utf8");
	if (data.length > MAX_FRAME_BYTES) throw new Error("Pi Fleet frame is too large");
	await new Promise<void>((resolvePromise, rejectPromise) => {
		socket.write(data, (error) => (error ? rejectPromise(error) : resolvePromise()));
	});
}

function listen(server: Server, path: string, signal?: AbortSignal): Promise<void> {
	return new Promise((resolvePromise, rejectPromise) => {
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", onAbort);
			server.off("error", onError);
			if (error) rejectPromise(error);
			else resolvePromise();
		};
		const onError = (error: Error) => finish(error);
		const onAbort = () => {
			server.close();
			finish(abortError("Pi Fleet transport start aborted"));
		};
		server.once("error", onError);
		server.listen(path, () => finish());
		signal?.addEventListener("abort", onAbort, { once: true });
		if (signal?.aborted) onAbort();
	});
}

function closeServer(server: Server): Promise<void> {
	return new Promise((resolvePromise) => {
		try {
			server.close(() => resolvePromise());
		} catch {
			resolvePromise();
		}
	});
}

class FleetEndpointError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "FleetEndpointError";
	}
}

function isDeadEndpointError(error: unknown): boolean {
	return (
		error instanceof FleetEndpointError &&
		(error.code === "ENOENT" ||
			error.code === "ECONNREFUSED" ||
			error.code === "ECONNRESET" ||
			error.code === "ETIMEDOUT")
	);
}

function randomId(prefix: string): string {
	return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
	const concrete = signals.filter((signal): signal is AbortSignal => signal !== undefined);
	return concrete.length === 1 ? concrete[0] : AbortSignal.any(concrete);
}

function throwIfAborted(signal: AbortSignal | undefined, message: string): void {
	if (signal?.aborted) throw abortError(message);
}

function abortError(message: string): Error {
	const error = new Error(message);
	error.name = "AbortError";
	return error;
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
