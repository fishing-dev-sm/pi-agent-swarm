import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import {
  contextHandoffDecision,
  initializeWorkerLineage,
  normalizeContextRecyclingPolicy,
  publishWorkerHandoff,
  readWorkerLineage,
  updateWorkerLineage,
  verifyWorkerHandoffReadable,
  type WorkerHandoffContent,
  workerLineagePaths,
} from "../src/context-recycling.js";

const handoff: WorkerHandoffContent = {
  originalObjective: "Repair the parser without changing its public API",
  currentState: "The failing case is isolated",
  completedWork: "Added a regression fixture",
  remainingWork: "Fix the parser and run final verification",
  modifiedFiles: "/project/src/parser.ts",
  verification: "The new fixture fails before the fix",
  decisions: "Keep the existing API because consumers depend on it",
  blocker: "None",
  nextAction: "Edit /project/src/parser.ts and rerun the fixture",
  artifacts: [],
};

test("context recycling policy is explicit, bounded, and defaults to a soft 50 percent threshold", () => {
  assert.deepEqual(normalizeContextRecyclingPolicy({ taskProfile: "auto" }), {
    taskProfile: "auto",
    maxContextPercent: 50,
    maxReplacements: 3,
  });
  assert.deepEqual(
    normalizeContextRecyclingPolicy({ taskProfile: "long", maxContextPercent: 60, maxReplacements: 5 }),
    { taskProfile: "long", maxContextPercent: 60, maxReplacements: 5 },
  );
  assert.throws(() => normalizeContextRecyclingPolicy({ taskProfile: "short", maxContextPercent: 0 }), /percent/iu);
  assert.throws(() => normalizeContextRecyclingPolicy({ taskProfile: "short", maxContextPercent: 101 }), /percent/iu);
  assert.throws(() => normalizeContextRecyclingPolicy({ taskProfile: "short", maxReplacements: -1 }), /replacements/iu);
  assert.throws(() => normalizeContextRecyclingPolicy({ taskProfile: "short", maxReplacements: 11 }), /replacements/iu);
});

test("a turn may cross the soft threshold; completion and unfinished work have different decisions", () => {
  assert.equal(contextHandoffDecision(45, "working"), "continue");
  assert.equal(contextHandoffDecision(52, "completed"), "complete");
  assert.equal(contextHandoffDecision(52, "working"), "handoff");
  assert.equal(contextHandoffDecision(52, undefined), "handoff");
  assert.equal(contextHandoffDecision(null, "working"), "continue");
  assert.equal(contextHandoffDecision(undefined, "working"), "continue");
});

test("handoff publication is atomic, project-local, and preserves lineage metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-swarm-recycling-"));
  const paths = workerLineagePaths(root, "lineage_123", 1);
  await publishWorkerHandoff({
    projectRoot: root,
    lineageId: "lineage_123",
    generation: 1,
    leaderSessionId: "leader-session",
    policy: { taskProfile: "long", maxContextPercent: 50, maxReplacements: 3 },
    launch: { cwd: root, name: "Worker", color: "#aabbcc", allowRequests: true },
    content: handoff,
    nextAction: handoff.nextAction,
  });

  const markdown = await readFile(paths.handoffPath, "utf8");
  assert.match(markdown, /Original objective and constraints/u);
  assert.match(markdown, /Exact next action/u);
  assert.match(markdown, /Repair the parser/u);
  const lineage = await readWorkerLineage(root, "lineage_123");
  assert.equal(lineage.state, "handoff_ready");
  assert.equal(lineage.currentGeneration, 1);
  assert.equal(lineage.currentHandoffPath, paths.handoffPath);
  assert.equal(lineage.nextAction, handoff.nextAction);
  assert.equal(lineage.projectRoot, root);
  assert.equal(JSON.stringify(lineage).includes("PI_SWARM_INVITE"), false);
  assert.equal(await readFile(join(root, ".pi", "agent-swarm", ".gitignore"), "utf8"), "*\n");
  await verifyWorkerHandoffReadable(root, {
    lineageId: "lineage_123",
    generation: 2,
    replacementCount: 1,
    policy: lineage.policy,
    handoffPath: paths.handoffPath,
  });
  await assert.rejects(
    verifyWorkerHandoffReadable(root, {
      lineageId: "lineage_123",
      generation: 2,
      replacementCount: 1,
      policy: lineage.policy,
      handoffPath: join(root, "missing-handoff.md"),
    }),
    /predecessor generation/iu,
  );

  await updateWorkerLineage(root, "lineage_123", { state: "replacing", customFutureField: { keep: true } });
  const updated = await readWorkerLineage(root, "lineage_123");
  assert.equal(updated.state, "replacing");
  assert.deepEqual(updated.customFutureField, { keep: true });
});

test("an old generation cannot overwrite a successor's durable lineage state", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-swarm-recycling-"));
  const lineageId = "lineage_stale_write";
  await publishWorkerHandoff({
    projectRoot,
    lineageId,
    generation: 1,
    leaderSessionId: "leader-session",
    policy: { taskProfile: "long", maxContextPercent: 50, maxReplacements: 3 },
    launch: { cwd: projectRoot, name: "Worker", allowRequests: true },
    content: handoff,
    nextAction: handoff.nextAction,
  });
  await updateWorkerLineage(projectRoot, lineageId, { currentGeneration: 2, replacementCount: 1, state: "working" });
  await assert.rejects(
    publishWorkerHandoff({
      projectRoot,
      lineageId,
      generation: 1,
      leaderSessionId: "leader-session",
      policy: { taskProfile: "long", maxContextPercent: 50, maxReplacements: 3 },
      launch: { cwd: projectRoot, name: "Worker", allowRequests: true },
      content: { ...handoff, completedWork: "Stale overwrite" },
      nextAction: handoff.nextAction,
    }),
    /superseded/iu,
  );
  assert.equal((await readWorkerLineage(projectRoot, lineageId)).currentGeneration, 2);
});

test("lineage writes serialize and expected state rejects stale worker transitions", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-swarm-recycling-"));
  const lineageId = "lineage_concurrent";
  await publishWorkerHandoff({
    projectRoot,
    lineageId,
    generation: 1,
    leaderSessionId: "leader-session",
    policy: { taskProfile: "long", maxContextPercent: 50, maxReplacements: 3 },
    launch: { cwd: projectRoot, allowRequests: true },
    content: handoff,
    nextAction: handoff.nextAction,
  });
  await Promise.all([
    updateWorkerLineage(projectRoot, lineageId, { contextUsage: { tokens: 52, contextWindow: 100, percent: 52 } }),
    updateWorkerLineage(projectRoot, lineageId, { nextAction: "Read the latest handoff and continue" }),
  ]);
  await assert.rejects(
    updateWorkerLineage(projectRoot, lineageId, { state: "handoff_pending" }, { generation: 1, state: "working" }),
    /state changed/iu,
  );
  const latest = await readWorkerLineage(projectRoot, lineageId);
  assert.equal(latest.state, "handoff_ready");
  assert.equal(latest.nextAction, "Read the latest handoff and continue");
  assert.equal(latest.contextUsage?.percent, 52);
});

test("an older worker reload cannot roll back a newer generation", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-swarm-recycling-"));
  const launch = {
    lineageId: "lineage_reload",
    generation: 1,
    replacementCount: 0,
    policy: { taskProfile: "auto" as const, maxContextPercent: 50, maxReplacements: 3 },
  };
  await initializeWorkerLineage({
    projectRoot,
    launch,
    leaderSessionId: "leader-session",
    workerSessionId: "worker-generation-1",
    specification: { cwd: projectRoot, allowRequests: true },
  });
  await updateWorkerLineage(projectRoot, launch.lineageId, {
    currentGeneration: 2,
    replacementCount: 1,
    state: "working",
  });
  const stale = await initializeWorkerLineage({
    projectRoot,
    launch,
    leaderSessionId: "leader-session",
    workerSessionId: "worker-generation-1",
    specification: { cwd: projectRoot, allowRequests: true },
  });
  assert.equal(stale.currentGeneration, 2);
  assert.equal((await readWorkerLineage(projectRoot, launch.lineageId)).currentGeneration, 2);
});

test("a successor lineage records its predecessor handoff pointer", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-swarm-recycling-"));
  const lineageId = "lineage_successor_pointer";
  const { handoffPath } = await publishWorkerHandoff({
    projectRoot,
    lineageId,
    generation: 1,
    leaderSessionId: "leader-session",
    policy: { taskProfile: "long", maxContextPercent: 50, maxReplacements: 3 },
    launch: { cwd: projectRoot, allowRequests: true },
    content: handoff,
    nextAction: handoff.nextAction,
  });
  const successor = await initializeWorkerLineage({
    projectRoot,
    launch: {
      lineageId,
      generation: 2,
      replacementCount: 1,
      policy: { taskProfile: "long", maxContextPercent: 50, maxReplacements: 3 },
      handoffPath,
    },
    leaderSessionId: "leader-session",
    workerSessionId: "worker-generation-2",
    specification: { cwd: projectRoot, allowRequests: true },
  });
  assert.equal(successor.currentGeneration, 2);
  assert.equal(successor.replacementCount, 1);
  assert.equal(successor.currentHandoffPath, handoffPath);
  assert.equal(successor.state, "working");
});

test("handoff paths reject unsafe identifiers and secret material", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-swarm-recycling-"));
  assert.throws(() => workerLineagePaths(root, "../escape", 1), /lineage/iu);
  await assert.rejects(
    publishWorkerHandoff({
      projectRoot: root,
      lineageId: "lineage_safe",
      generation: 1,
      leaderSessionId: "leader-session",
      policy: { taskProfile: "short", maxContextPercent: 50, maxReplacements: 1 },
      launch: { cwd: root, allowRequests: false },
      content: { ...handoff, decisions: "Use piagentswarm:v1:secret" },
      nextAction: handoff.nextAction,
    }),
    /secret/iu,
  );
  await assert.rejects(
    publishWorkerHandoff({
      projectRoot: root,
      lineageId: "lineage_safe",
      generation: 1,
      leaderSessionId: "leader-session",
      policy: { taskProfile: "short", maxContextPercent: 50, maxReplacements: 1 },
      launch: { cwd: root, allowRequests: false },
      content: { ...handoff, artifacts: ["/outside/secret.log"] },
      nextAction: handoff.nextAction,
    }),
    /artifact.*outside/iu,
  );
});
