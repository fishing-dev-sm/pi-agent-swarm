import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "vitest";
import {
	createGroup,
	createSignedFrame,
	FixedWindowRateLimiter,
	formatInvite,
	JsonLineDecoder,
	MAX_FRAME_BYTES,
	MAX_MESSAGE_BYTES,
	parseInvite,
	ReplayWindow,
	validateMessage,
	verifySignedFrame,
} from "../src/protocol.js";

const NOW = 1_800_000_000_000;

function message(text = "hello") {
	return {
		id: "msg_1234567890abcdef",
		fromSessionId: "sender",
		toSessionId: "receiver",
		mode: "notify" as const,
		text,
		issuedAt: NOW,
	};
}

test("invite round-trips a 32-byte secret and rejects malformed input", () => {
	const group = createGroup(Buffer.alloc(32, 7));
	const invite = formatInvite(group.secret);
	assert.match(invite, /^pifleet:v1:[A-Za-z0-9_-]{43}$/u);
	assert.deepEqual(parseInvite(invite), group);
	assert.throws(() => parseInvite(" pifleet:v1:bad "), /invalid/u);
	assert.throws(() => createGroup(Buffer.alloc(31)), /32 bytes/u);
});

test("signed frames authenticate group, target, time, and replay identity", () => {
	const group = createGroup(Buffer.alloc(32, 3));
	const frame = createSignedFrame(
		{
			groupId: group.id,
			requestId: "req_1234567890abcdef",
			targetSessionId: "receiver",
			senderSessionId: "sender",
			issuedAt: NOW,
			nonce: "nonce_1234567890abcdef",
			payload: { kind: "message", message: message() },
		},
		group.secret,
	);
	const replay = new ReplayWindow(8, 60_000);
	assert.deepEqual(
		verifySignedFrame(frame, group.secret, {
			expectedGroupId: group.id,
			expectedTargetSessionId: "receiver",
			now: NOW,
			replay,
		}),
		frame,
	);
	assert.throws(
		() =>
			verifySignedFrame(frame, group.secret, {
				expectedGroupId: group.id,
				expectedTargetSessionId: "receiver",
				now: NOW,
				replay,
			}),
		/replayed/u,
	);
	assert.throws(
		() =>
			verifySignedFrame(frame, randomBytes(32), {
				expectedGroupId: group.id,
				expectedTargetSessionId: "receiver",
				now: NOW,
			}),
		/authentication/u,
	);
	assert.throws(
		() =>
			verifySignedFrame(frame, group.secret, {
				expectedGroupId: "wrong",
				expectedTargetSessionId: "receiver",
				now: NOW,
			}),
		/group/u,
	);
	assert.throws(
		() =>
			verifySignedFrame(frame, group.secret, {
				expectedGroupId: group.id,
				expectedTargetSessionId: "other",
				now: NOW,
			}),
		/target/u,
	);
	assert.throws(
		() =>
			verifySignedFrame(frame, group.secret, {
				expectedGroupId: group.id,
				expectedTargetSessionId: "receiver",
				now: NOW + 60_001,
				maxClockSkewMs: 60_000,
			}),
		/expired/u,
	);
	assert.throws(
		() =>
			verifySignedFrame({ ...frame, mac: `${frame.mac.slice(0, -1)}x` }, group.secret, {
				expectedGroupId: group.id,
				expectedTargetSessionId: "receiver",
				now: NOW,
			}),
		/authentication/u,
	);
});

test("message validation uses UTF-8 byte limits and preserves raw controls", () => {
	const raw = "first\n\u001b[31m紅色\u001b[0m";
	assert.equal(validateMessage(message(raw)).text, raw);
	assert.equal(
		validateMessage(message("界".repeat(Math.floor(MAX_MESSAGE_BYTES / 3)))).text.length > 0,
		true,
	);
	assert.throws(
		() => validateMessage(message("界".repeat(Math.floor(MAX_MESSAGE_BYTES / 3) + 1))),
		/message is too large/u,
	);
	assert.throws(() => validateMessage({ ...message(), mode: "execute" }), /mode/u);
	assert.throws(() => validateMessage({ ...message(), id: "bad id" }), /message id/u);
});

test("JSONL decoder handles fragments and rejects malformed, invalid UTF-8, and oversized records", () => {
	const values: unknown[] = [];
	const errors: string[] = [];
	const decoder = new JsonLineDecoder({
		onValue: (value) => values.push(value),
		onError: (error) => errors.push(error.message),
	});
	decoder.push(Buffer.from('{"ok":'));
	decoder.push(Buffer.from("true}\r\n"));
	assert.deepEqual(values, [{ ok: true }]);
	decoder.push(Buffer.from("{bad}\n"));
	assert.match(errors.at(-1) ?? "", /malformed/u);
	decoder.push(Buffer.from([0xc3, 0x28, 0x0a]));
	assert.match(errors.at(-1) ?? "", /UTF-8/u);
	decoder.push(Buffer.alloc(MAX_FRAME_BYTES + 1, 0x61));
	assert.match(errors.at(-1) ?? "", /too large/u);
	decoder.finish();
});

test("replay and rate windows remain bounded and expire entries", () => {
	const replay = new ReplayWindow(2, 100);
	assert.equal(replay.accept("a", 0), true);
	assert.equal(replay.accept("a", 1), false);
	assert.equal(replay.accept("b", 2), true);
	assert.equal(replay.accept("c", 3), true);
	assert.equal(replay.size, 2);
	assert.equal(replay.accept("a", 101), true);

	const limiter = new FixedWindowRateLimiter(2, 100);
	assert.equal(limiter.accept("peer", 0), true);
	assert.equal(limiter.accept("peer", 1), true);
	assert.equal(limiter.accept("peer", 2), false);
	assert.equal(limiter.accept("peer", 101), true);
});
