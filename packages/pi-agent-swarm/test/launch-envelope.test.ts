import assert from "node:assert/strict";
import { test } from "vitest";
import { consumeLaunchEnvelope, launchEnvelopeEnvironment } from "../src/launch-envelope.js";
import { createGroup, formatInvite } from "../src/protocol.js";

function baseEnvironment(): NodeJS.ProcessEnv {
  return {
    PI_SWARM_INVITE: formatInvite(createGroup(Buffer.alloc(32, 15)).secret),
    PI_SWARM_PARENT_SESSION_ID: "parent",
    PI_SWARM_LAUNCH_ID: "launch_12345678",
    PI_SWARM_KICKOFF_CAPABILITY: "kickoff_1234567890abcdef",
    PI_SWARM_ACCEPT_REQUESTS: "0",
  };
}

test("launch envelope requires a parent-only kickoff capability and consumes every key", () => {
  const environment = baseEnvironment();
  delete environment.PI_SWARM_KICKOFF_CAPABILITY;
  assert.throws(() => consumeLaunchEnvelope(environment), /kickoff capability/u);
  assert.deepEqual(environment, {});
});

test("launch thinking level is rejected without a complete model identity and all keys are consumed", () => {
  const environment = { ...baseEnvironment(), PI_SWARM_THINKING: "high" };
  assert.throws(() => consumeLaunchEnvelope(environment), /model identity is incomplete/u);
  assert.deepEqual(environment, {});
});

test("launch context recycling policy survives the envelope without exposing capabilities in lineage metadata", () => {
  const environment = {
    ...baseEnvironment(),
    ...launchEnvelopeEnvironment({
      invite: baseEnvironment().PI_SWARM_INVITE ?? "",
      parentSessionId: "parent",
      launchId: "launch_12345678",
      kickoffCapability: "kickoff_1234567890abcdef",
      acceptsRequests: true,
      contextRecycling: {
        lineageId: "lineage_12345678",
        generation: 1,
        replacementCount: 0,
        policy: { taskProfile: "long", maxContextPercent: 50, maxReplacements: 2 },
      },
    }),
  };
  const envelope = consumeLaunchEnvelope(environment);
  assert.deepEqual(envelope?.contextRecycling, {
    lineageId: "lineage_12345678",
    generation: 1,
    replacementCount: 0,
    policy: { taskProfile: "long", maxContextPercent: 50, maxReplacements: 2 },
  });
  assert.deepEqual(environment, {});
});

test("successor launch envelope carries the exact predecessor handoff path", () => {
  const contextRecycling = {
    lineageId: "lineage_12345678",
    generation: 2,
    replacementCount: 1,
    policy: { taskProfile: "long", maxContextPercent: 50, maxReplacements: 2 },
    handoffPath: "/project/.pi/agent-swarm/lineages/lineage_12345678/generations/0001-handoff.md",
  } as const;
  const environment = {
    ...baseEnvironment(),
    PI_SWARM_CONTEXT_RECYCLING: JSON.stringify(contextRecycling),
  };
  assert.deepEqual(consumeLaunchEnvelope(environment)?.contextRecycling, contextRecycling);
  assert.deepEqual(environment, {});
});

test("invalid launch context recycling policy is consumed and rejected", () => {
  const environment = {
    ...baseEnvironment(),
    PI_SWARM_CONTEXT_RECYCLING: JSON.stringify({ lineageId: "../escape", generation: 1, replacementCount: 0 }),
  };
  assert.throws(() => consumeLaunchEnvelope(environment), /lineage|policy/iu);
  assert.deepEqual(environment, {});
});
