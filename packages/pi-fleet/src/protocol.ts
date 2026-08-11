import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { TextDecoder } from "node:util";

export const FLEET_PROTOCOL_VERSION = 1;
export const INVITE_PREFIX = "pifleet:v1:";
export const MAX_FRAME_BYTES = 32 * 1024;
export const MAX_MESSAGE_BYTES = 16 * 1024;
export const DEFAULT_CLOCK_SKEW_MS = 60_000;

const GROUP_DOMAIN = "pi-fleet/group/v1\0";
const MAC_DOMAIN = "pi-fleet/frame/v1\0";
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const GROUP_ID = /^[a-f0-9]{32}$/u;
const BASE64URL_32_BYTES = /^[A-Za-z0-9_-]{43}$/u;
const BASE64URL_MAC = /^[A-Za-z0-9_-]{43}$/u;

export interface FleetGroup {
	id: string;
	secret: Buffer;
}

export type FleetMessageMode = "notify" | "request" | "reply" | "kickoff";

export interface FleetMessage {
	id: string;
	fromSessionId: string;
	fromName?: string;
	fromCwd?: string;
	toSessionId: string;
	mode: FleetMessageMode;
	text: string;
	issuedAt: number;
	replyTo?: string;
	launchId?: string;
}

export interface FleetPeerDescription {
	protocolVersion: number;
	sessionId: string;
	name?: string;
	cwd: string;
	pid: number;
	launchId?: string;
	acceptsRequests: boolean;
}

export type FleetPayload =
	| { kind: "describe" }
	| { kind: "description"; peer: FleetPeerDescription }
	| { kind: "message"; message: FleetMessage }
	| { kind: "ack"; accepted: boolean; duplicate?: boolean; error?: string };

export interface UnsignedFleetFrame {
	groupId: string;
	requestId: string;
	targetSessionId: string;
	senderSessionId: string;
	issuedAt: number;
	nonce: string;
	payload: FleetPayload;
}

export interface SignedFleetFrame extends UnsignedFleetFrame {
	version: typeof FLEET_PROTOCOL_VERSION;
	mac: string;
}

export interface VerifyFrameOptions {
	expectedGroupId: string;
	expectedTargetSessionId: string;
	now?: number;
	maxClockSkewMs?: number;
	replay?: ReplayWindow;
}

export function createGroup(secret: Uint8Array = randomBytes(32)): FleetGroup {
	const copied = Buffer.from(secret);
	if (copied.length !== 32) throw new Error("Pi Fleet group secret must be exactly 32 bytes");
	const id = createHash("sha256").update(GROUP_DOMAIN).update(copied).digest("hex").slice(0, 32);
	return { id, secret: copied };
}

export function formatInvite(secret: Uint8Array): string {
	return `${INVITE_PREFIX}${createGroup(secret).secret.toString("base64url")}`;
}

export function parseInvite(value: string): FleetGroup {
	if (value !== value.trim() || !value.startsWith(INVITE_PREFIX)) {
		throw new Error("Pi Fleet invite is invalid");
	}
	const encoded = value.slice(INVITE_PREFIX.length);
	if (!BASE64URL_32_BYTES.test(encoded)) throw new Error("Pi Fleet invite is invalid");
	let secret: Buffer;
	try {
		secret = Buffer.from(encoded, "base64url");
	} catch {
		throw new Error("Pi Fleet invite is invalid");
	}
	if (secret.length !== 32 || secret.toString("base64url") !== encoded) {
		throw new Error("Pi Fleet invite is invalid");
	}
	return createGroup(secret);
}

export function createSignedFrame(input: UnsignedFleetFrame, secret: Uint8Array): SignedFleetFrame {
	const frameWithoutMac = {
		version: FLEET_PROTOCOL_VERSION as typeof FLEET_PROTOCOL_VERSION,
		...normalizeUnsignedFrame(input),
	};
	return {
		...frameWithoutMac,
		mac: frameMac(frameWithoutMac, secret),
	};
}

export function verifySignedFrame(
	value: unknown,
	secret: Uint8Array,
	options: VerifyFrameOptions,
): SignedFleetFrame {
	const frame = normalizeSignedFrame(value);
	if (frame.groupId !== options.expectedGroupId) {
		throw new Error("Pi Fleet frame belongs to the wrong group");
	}
	if (frame.targetSessionId !== options.expectedTargetSessionId) {
		throw new Error("Pi Fleet frame targets another session");
	}
	const now = options.now ?? Date.now();
	const maxClockSkewMs = options.maxClockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;
	if (Math.abs(now - frame.issuedAt) > maxClockSkewMs) {
		throw new Error("Pi Fleet frame expired outside the accepted clock window");
	}
	const { mac, ...unsigned } = frame;
	const expected = frameMac(unsigned, secret);
	if (!safeMacEqual(mac, expected)) throw new Error("Pi Fleet frame authentication failed");
	const replayKey = `${frame.senderSessionId}:${frame.requestId}:${frame.nonce}`;
	if (options.replay && !options.replay.accept(replayKey, now)) {
		throw new Error("Pi Fleet frame was replayed");
	}
	return frame;
}

export function validateMessage(value: unknown): FleetMessage {
	if (!isRecord(value)) throw new Error("Pi Fleet message must be an object");
	const id = requiredId(value.id, "message id");
	const fromSessionId = requiredId(value.fromSessionId, "sender session id");
	const fromName = optionalBoundedString(value.fromName, "sender name", 200);
	const fromCwd = optionalBoundedString(value.fromCwd, "sender cwd", 4_096);
	const toSessionId = requiredId(value.toSessionId, "target session id");
	const mode = value.mode;
	if (mode !== "notify" && mode !== "request" && mode !== "reply" && mode !== "kickoff") {
		throw new Error("Pi Fleet message mode is invalid");
	}
	if (typeof value.text !== "string") throw new Error("Pi Fleet message text must be a string");
	if (Buffer.byteLength(value.text, "utf8") > MAX_MESSAGE_BYTES) {
		throw new Error("Pi Fleet message is too large");
	}
	const issuedAt = finiteInteger(value.issuedAt, "message issued time");
	const replyTo = optionalId(value.replyTo, "reply message id");
	const launchId = optionalId(value.launchId, "launch id");
	if (mode === "reply" && !replyTo) throw new Error("Pi Fleet reply requires a reply message id");
	if (mode === "kickoff" && !launchId) throw new Error("Pi Fleet kickoff requires a launch id");
	return {
		id,
		fromSessionId,
		...(fromName ? { fromName } : {}),
		...(fromCwd ? { fromCwd } : {}),
		toSessionId,
		mode,
		text: value.text,
		issuedAt,
		...(replyTo ? { replyTo } : {}),
		...(launchId ? { launchId } : {}),
	};
}

export class ReplayWindow {
	private readonly entries = new Map<string, number>();

	constructor(
		private readonly capacity: number,
		private readonly ttlMs: number,
	) {
		if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Replay capacity is invalid");
		if (!Number.isFinite(ttlMs) || ttlMs < 1) throw new Error("Replay TTL is invalid");
	}

	accept(key: string, now: number): boolean {
		if (this.has(key, now)) return false;
		this.record(key, now);
		return true;
	}

	has(key: string, now: number): boolean {
		this.prune(now);
		return this.entries.has(key);
	}

	record(key: string, now: number): void {
		this.prune(now);
		this.entries.delete(key);
		this.entries.set(key, now + this.ttlMs);
		while (this.entries.size > this.capacity) {
			const oldest = this.entries.keys().next().value as string | undefined;
			if (oldest === undefined) break;
			this.entries.delete(oldest);
		}
	}

	get size(): number {
		return this.entries.size;
	}

	private prune(now: number): void {
		for (const [key, expiresAt] of this.entries) {
			if (expiresAt > now) continue;
			this.entries.delete(key);
		}
	}
}

export class FixedWindowRateLimiter {
	private readonly entries = new Map<string, { start: number; count: number }>();

	constructor(
		private readonly limit: number,
		private readonly windowMs: number,
		private readonly maxKeys = 128,
	) {
		if (!Number.isInteger(limit) || limit < 1) throw new Error("Rate limit is invalid");
		if (!Number.isFinite(windowMs) || windowMs < 1) throw new Error("Rate window is invalid");
		if (!Number.isInteger(maxKeys) || maxKeys < 1) throw new Error("Rate key limit is invalid");
	}

	accept(key: string, now: number): boolean {
		const current = this.entries.get(key);
		if (!current || now - current.start >= this.windowMs || now < current.start) {
			this.entries.delete(key);
			this.entries.set(key, { start: now, count: 1 });
			this.trim();
			return true;
		}
		if (current.count >= this.limit) return false;
		current.count += 1;
		this.entries.delete(key);
		this.entries.set(key, current);
		return true;
	}

	private trim(): void {
		while (this.entries.size > this.maxKeys) {
			const oldest = this.entries.keys().next().value as string | undefined;
			if (oldest === undefined) break;
			this.entries.delete(oldest);
		}
	}
}

export interface JsonLineDecoderOptions {
	onValue(value: unknown): void;
	onError(error: Error): void;
	maxBytes?: number;
}

export class JsonLineDecoder {
	private buffer = Buffer.alloc(0);
	private discarding = false;
	private readonly maxBytes: number;

	constructor(private readonly options: JsonLineDecoderOptions) {
		this.maxBytes = options.maxBytes ?? MAX_FRAME_BYTES;
	}

	push(chunk: Buffer | Uint8Array): void {
		let incoming = Buffer.from(chunk);
		if (this.discarding) {
			const newline = incoming.indexOf(0x0a);
			if (newline < 0) return;
			incoming = incoming.subarray(newline + 1);
			this.discarding = false;
		}
		if (incoming.length === 0) return;
		this.buffer = Buffer.concat([this.buffer, incoming]);
		while (true) {
			const newline = this.buffer.indexOf(0x0a);
			if (newline < 0) break;
			const line = this.buffer.subarray(0, newline);
			this.buffer = this.buffer.subarray(newline + 1);
			if (line.length > this.maxBytes) {
				this.options.onError(new Error("Pi Fleet JSONL record is too large"));
				continue;
			}
			this.decodeLine(line);
		}
		if (this.buffer.length > this.maxBytes) {
			this.buffer = Buffer.alloc(0);
			this.discarding = true;
			this.options.onError(new Error("Pi Fleet JSONL record is too large"));
		}
	}

	finish(): void {
		if (this.discarding) {
			this.discarding = false;
			return;
		}
		if (this.buffer.length === 0) return;
		const line = this.buffer;
		this.buffer = Buffer.alloc(0);
		this.decodeLine(line);
	}

	private decodeLine(value: Buffer): void {
		const line = value.at(-1) === 0x0d ? value.subarray(0, -1) : value;
		if (line.length === 0) return;
		let text: string;
		try {
			text = new TextDecoder("utf-8", { fatal: true }).decode(line);
		} catch {
			this.options.onError(new Error("Pi Fleet JSONL record contains invalid UTF-8"));
			return;
		}
		try {
			this.options.onValue(JSON.parse(text));
		} catch {
			this.options.onError(new Error("Pi Fleet JSONL record is malformed JSON"));
		}
	}
}

function normalizeUnsignedFrame(value: UnsignedFleetFrame): UnsignedFleetFrame {
	if (!isRecord(value)) throw new Error("Pi Fleet frame must be an object");
	const groupId = value.groupId;
	if (typeof groupId !== "string" || !GROUP_ID.test(groupId)) {
		throw new Error("Pi Fleet frame group id is invalid");
	}
	const requestId = requiredId(value.requestId, "request id");
	const targetSessionId = requiredId(value.targetSessionId, "target session id");
	const senderSessionId = requiredId(value.senderSessionId, "sender session id");
	const issuedAt = finiteInteger(value.issuedAt, "frame issued time");
	const nonce = requiredId(value.nonce, "frame nonce");
	const payload = validatePayload(value.payload);
	return {
		groupId,
		requestId,
		targetSessionId,
		senderSessionId,
		issuedAt,
		nonce,
		payload,
	};
}

function normalizeSignedFrame(value: unknown): SignedFleetFrame {
	if (!isRecord(value)) throw new Error("Pi Fleet frame must be an object");
	if (value.version !== FLEET_PROTOCOL_VERSION) {
		throw new Error("Pi Fleet frame protocol version is unsupported");
	}
	const normalized = normalizeUnsignedFrame(value as unknown as UnsignedFleetFrame);
	if (typeof value.mac !== "string" || !BASE64URL_MAC.test(value.mac)) {
		throw new Error("Pi Fleet frame authentication tag is invalid");
	}
	return { version: FLEET_PROTOCOL_VERSION, ...normalized, mac: value.mac };
}

function validatePayload(value: unknown): FleetPayload {
	if (!isRecord(value) || typeof value.kind !== "string") {
		throw new Error("Pi Fleet frame payload is invalid");
	}
	if (value.kind === "describe") return { kind: "describe" };
	if (value.kind === "description") {
		return { kind: "description", peer: validatePeerDescription(value.peer) };
	}
	if (value.kind === "message") {
		return { kind: "message", message: validateMessage(value.message) };
	}
	if (value.kind === "ack") {
		if (typeof value.accepted !== "boolean") throw new Error("Pi Fleet ack is invalid");
		const error = optionalBoundedString(value.error, "ack error", 1_000);
		return {
			kind: "ack",
			accepted: value.accepted,
			...(value.duplicate === true ? { duplicate: true } : {}),
			...(error ? { error } : {}),
		};
	}
	throw new Error("Pi Fleet frame payload kind is invalid");
}

export function validatePeerDescription(value: unknown): FleetPeerDescription {
	if (!isRecord(value)) throw new Error("Pi Fleet peer description is invalid");
	if (value.protocolVersion !== FLEET_PROTOCOL_VERSION) {
		throw new Error("Pi Fleet peer protocol version is unsupported");
	}
	const sessionId = requiredId(value.sessionId, "peer session id");
	const name = optionalBoundedString(value.name, "peer name", 200);
	const cwd = optionalBoundedString(value.cwd, "peer cwd", 4_096);
	if (cwd === undefined) throw new Error("Pi Fleet peer cwd is invalid");
	const pid = finiteInteger(value.pid, "peer process id");
	if (pid < 1) throw new Error("Pi Fleet peer process id is invalid");
	const launchId = optionalId(value.launchId, "peer launch id");
	if (typeof value.acceptsRequests !== "boolean") {
		throw new Error("Pi Fleet peer request policy is invalid");
	}
	return {
		protocolVersion: FLEET_PROTOCOL_VERSION,
		sessionId,
		...(name ? { name } : {}),
		cwd,
		pid,
		...(launchId ? { launchId } : {}),
		acceptsRequests: value.acceptsRequests,
	};
}

function frameMac(value: object, secret: Uint8Array): string {
	const key = Buffer.from(secret);
	if (key.length !== 32) throw new Error("Pi Fleet group secret must be exactly 32 bytes");
	return createHmac("sha256", key)
		.update(MAC_DOMAIN)
		.update(canonicalJson(value))
		.digest("base64url");
}

function safeMacEqual(actual: string, expected: string): boolean {
	const actualBytes = Buffer.from(actual);
	const expectedBytes = Buffer.from(expected);
	return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value === "boolean" || typeof value === "string") {
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("Pi Fleet frame contains a non-finite number");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	if (isRecord(value)) {
		return `{${Object.keys(value)
			.filter((key) => value[key] !== undefined)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(",")}}`;
	}
	throw new Error("Pi Fleet frame contains unsupported data");
}

function requiredId(value: unknown, label: string): string {
	if (typeof value !== "string" || !SAFE_ID.test(value)) {
		throw new Error(`Pi Fleet ${label} is invalid`);
	}
	return value;
}

function optionalId(value: unknown, label: string): string | undefined {
	if (value === undefined) return undefined;
	return requiredId(value, label);
}

function optionalBoundedString(
	value: unknown,
	label: string,
	maxBytes: number,
): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maxBytes) {
		throw new Error(`Pi Fleet ${label} is invalid`);
	}
	return value;
}

function finiteInteger(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value)) {
		throw new Error(`Pi Fleet ${label} is invalid`);
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
