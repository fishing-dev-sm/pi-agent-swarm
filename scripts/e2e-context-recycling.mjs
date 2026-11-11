#!/usr/bin/env node
/**
 * Repeatable end-to-end check for worker context recycling.
 *
 * It starts real, isolated Pi RPC processes (temporary agent dir, temporary
 * project, no model requests) with a hand-built launch envelope and verifies the
 * on-disk lineage contract:
 *
 *   1. generation 1 joins and publishes a working lineage plus storage ignore.
 *   2. generation 2 without a readable predecessor handoff refuses to join.
 *   3. generation 2 with a complete handoff joins as a working successor.
 *
 * Evidence is written to node_modules/.cache/e2e-context-recycling/<runId>/.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = join(repositoryRoot, "packages", "pi-agent-swarm");
const runId = new Date().toISOString().replace(/[:.]/gu, "-");
const evidenceRoot = join(repositoryRoot, "node_modules", ".cache", "e2e-context-recycling", runId);
const lineageId = `lineage_e2e_${randomBytes(6).toString("hex")}`;
const parentSessionId = `parent_${randomBytes(6).toString("hex")}`;
const launchId = `launch_${randomBytes(8).toString("hex")}`;
const kickoffCapability = `kickoff_${randomBytes(16).toString("hex")}`;
const invite = `piagentswarm:v1:${randomBytes(32).toString("base64url")}`;
const HANDOFF_SECTIONS = [
  "Original objective and constraints",
  "Current state",
  "Completed work",
  "Remaining work",
  "Modified files and Git state",
  "Verification performed and its results",
  "Key decisions and their rationale",
  "Current problem or blocker",
  "Exact next action",
  "Required project files and artifact paths",
];

function cleanEnvironment() {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("PI_SWARM_") || key === "PI_CODING_AGENT_DIR") delete environment[key];
  }
  return environment;
}

function buildEnvelope({ projectRoot, agentDir, generation, handoffPath, name }) {
  const contextRecycling = {
    lineageId,
    generation,
    replacementCount: generation - 1,
    policy: { taskProfile: "long", maxContextPercent: 50, maxReplacements: 3 },
    ...(handoffPath ? { handoffPath } : {}),
  };
  return {
    ...cleanEnvironment(),
    PI_CODING_AGENT_DIR: agentDir,
    PI_SWARM_INVITE: invite,
    PI_SWARM_PARENT_SESSION_ID: parentSessionId,
    PI_SWARM_LAUNCH_ID: launchId,
    PI_SWARM_KICKOFF_CAPABILITY: kickoffCapability,
    PI_SWARM_ACCEPT_REQUESTS: "1",
    PI_SWARM_CHILD_NAME: name,
    PI_SWARM_CONTEXT_RECYCLING: JSON.stringify(contextRecycling),
    PI_SWARM_CWD: projectRoot,
  };
}

async function startSession({ projectRoot, agentDir, generation, handoffPath, name }) {
  const child = spawn("pi", ["--mode", "rpc", "--no-session", "--no-extensions", "-e", extensionPath], {
    cwd: projectRoot,
    env: buildEnvelope({ projectRoot, agentDir, generation, handoffPath, name }),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const events = [];
  const stderr = [];
  const waiters = new Set();
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        events.push(line);
        for (const waiter of waiters) waiter();
      }
      index = buffer.indexOf("\n");
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exited = new Promise((resolveExit) => child.once("exit", (code, signal) => resolveExit({ code, signal })));
  return {
    child,
    events,
    stderr,
    exited,
    text: () => events.join("\n"),
    waitFor: async (predicate, timeoutMs, label) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((wait) => {
          const timer = setTimeout(() => {
            waiters.delete(wake);
            wait();
          }, 50);
          const wake = () => {
            clearTimeout(timer);
            waiters.delete(wake);
            wait();
          };
          waiters.add(wake);
        });
      }
      throw new Error(`Timed out waiting for ${label}`);
    },
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await Promise.race([exited, new Promise((wait) => setTimeout(wait, 5_000))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}

async function readLineage(projectRoot) {
  const path = join(projectRoot, ".pi", "agent-swarm", "lineages", lineageId, "lineage.json");
  return JSON.parse(await readFile(path, "utf8"));
}

async function waitForLineage(projectRoot, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const lineage = await readLineage(projectRoot);
      if (predicate(lineage)) return lineage;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    await new Promise((wait) => setTimeout(wait, 100));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

function handoffMarkdown() {
  return [
    "# Worker handoff",
    "",
    ...HANDOFF_SECTIONS.flatMap((section, index) => [`## ${section}`, `E2E fixture value ${index + 1}`, ""]),
    "## Required project files and artifact paths",
    "No artifacts are required for this fixture.",
    "",
  ].join("\n");
}

async function run() {
  const sandbox = await mkdtemp(join(tmpdir(), "pi-swarm-e2e-recycling-"));
  const projectRoot = join(sandbox, "project");
  const agentDir = join(sandbox, "agent");
  await mkdir(projectRoot, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "settings.json"), "{}\n");
  await writeFile(join(projectRoot, "README.md"), "# E2E project\n");
  await mkdir(evidenceRoot, { recursive: true });

  const report = { runId, lineageId, projectRoot, agentDir, steps: [] };
  let generationOneSessionId;
  let successorSessionId;

  const generationOne = await startSession({
    projectRoot,
    agentDir,
    generation: 1,
    name: "E2E-WORKER-1",
  });
  try {
    const lineage = await waitForLineage(projectRoot, (value) => value.state === "working", 30_000, "generation 1");
    assert.equal(lineage.currentGeneration, 1);
    assert.equal(lineage.replacementCount, 0);
    assert.equal(lineage.policy.maxContextPercent, 50);
    assert.equal(lineage.policy.taskProfile, "long");
    assert.equal(lineage.leaderSessionId, parentSessionId);
    assert.ok(lineage.workerSessionId, "generation 1 must record its worker session id");
    assert.equal(typeof lineage.updatedAt, "string");
    generationOneSessionId = lineage.workerSessionId;

    const ignore = await readFile(join(projectRoot, ".pi", "agent-swarm", ".gitignore"), "utf8");
    assert.equal(ignore, "*\n");
    const serialized = JSON.stringify(lineage);
    assert.equal(serialized.includes("piagentswarm:v1:"), false);
    assert.equal(serialized.includes(kickoffCapability), false);

    generationOne.child.stdin.write(
      `${JSON.stringify({ id: "req-1", type: "prompt", message: "/swarm requests on" })}\n`,
    );
    await generationOne.waitFor(
      () => generationOne.text().includes("requests") || generationOne.text().includes("pi-agent-swarm"),
      15_000,
      "the extension command response",
    );
    report.steps.push({
      step: "generation 1 joins with a working lineage",
      state: lineage.state,
      workerSessionId: generationOneSessionId,
      gitignore: ignore,
    });
    await writeFile(join(evidenceRoot, "generation-1-lineage.json"), `${JSON.stringify(lineage, null, 2)}\n`);
    await writeFile(join(evidenceRoot, "generation-1-events.jsonl"), `${generationOne.events.join("\n")}\n`);
  } finally {
    await generationOne.stop();
  }

  const missingHandoff = join(
    projectRoot,
    ".pi",
    "agent-swarm",
    "lineages",
    lineageId,
    "generations",
    "9999-handoff.md",
  );
  const rejected = await startSession({
    projectRoot,
    agentDir,
    generation: 2,
    handoffPath: missingHandoff,
    name: "E2E-WORKER-2-MISSING",
  });
  try {
    await rejected.waitFor(
      () => rejected.text().includes("could not join the launch group") || rejected.text().includes("handoff"),
      30_000,
      "the missing-handoff rejection",
    );
    await new Promise((wait) => setTimeout(wait, 500));
    const lineage = await readLineage(projectRoot);
    assert.equal(lineage.currentGeneration, 1, "a rejected successor must not create generation 2");
    assert.equal(lineage.state, "working");
    report.steps.push({
      step: "generation 2 without a readable handoff is rejected",
      currentGeneration: lineage.currentGeneration,
      state: lineage.state,
    });
    await writeFile(join(evidenceRoot, "generation-2-missing-handoff-events.jsonl"), `${rejected.events.join("\n")}\n`);
  } finally {
    await rejected.stop();
  }

  const handoffDirectory = join(projectRoot, ".pi", "agent-swarm", "lineages", lineageId, "generations");
  await mkdir(handoffDirectory, { recursive: true });
  const handoffPath = join(handoffDirectory, "0001-handoff.md");
  await writeFile(handoffPath, handoffMarkdown());

  const successor = await startSession({
    projectRoot,
    agentDir,
    generation: 2,
    handoffPath,
    name: "E2E-WORKER-2",
  });
  try {
    const lineage = await waitForLineage(
      projectRoot,
      (value) => value.currentGeneration === 2 && value.state === "working",
      30_000,
      "generation 2",
    );
    assert.equal(lineage.replacementCount, 1);
    assert.notEqual(lineage.workerSessionId, generationOneSessionId);
    assert.equal(lineage.currentHandoffPath, handoffPath);
    successorSessionId = lineage.workerSessionId;
    report.steps.push({
      step: "generation 2 joins after reading a complete handoff",
      currentGeneration: lineage.currentGeneration,
      replacementCount: lineage.replacementCount,
      workerSessionId: successorSessionId,
      handoffPath,
    });
    await writeFile(join(evidenceRoot, "generation-2-lineage.json"), `${JSON.stringify(lineage, null, 2)}\n`);
    await writeFile(join(evidenceRoot, "generation-2-events.jsonl"), `${successor.events.join("\n")}\n`);
    await writeFile(join(evidenceRoot, "0001-handoff.md"), handoffMarkdown());
  } finally {
    await successor.stop();
  }

  const verification = {
    ok: true,
    lineageId,
    generationOneSessionId,
    successorSessionId,
    handoffPath,
    evidenceRoot,
    steps: report.steps,
  };
  await writeFile(join(evidenceRoot, "report.json"), `${JSON.stringify(verification, null, 2)}\n`);
  await rm(sandbox, { recursive: true, force: true });
  return verification;
}

const verification = await run().catch(async (error) => {
  await mkdir(evidenceRoot, { recursive: true }).catch(() => undefined);
  await writeFile(
    join(evidenceRoot, "failure.json"),
    `${JSON.stringify({ ok: false, message: error instanceof Error ? error.stack : String(error) }, null, 2)}\n`,
  ).catch(() => undefined);
  throw error;
});
process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
