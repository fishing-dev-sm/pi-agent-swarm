import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export const WORKER_RECYCLING_DIRECTORY = join(".pi", "agent-swarm");
export const DEFAULT_MAX_CONTEXT_PERCENT = 50;
export const DEFAULT_MAX_REPLACEMENTS = 3;
export const MAX_REPLACEMENTS = 10;

const SAFE_LINEAGE_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const TASK_PROFILES = new Set(["short", "long", "auto"]);
const LINEAGE_STATES = new Set([
  "working",
  "handoff_pending",
  "handoff_ready",
  "replacing",
  "retired",
  "completed",
  "failed",
]);
const SECRET_PATTERNS = [
  /piagentswarm:v1:/iu,
  /PI_SWARM_INVITE/iu,
  /PI_SWARM_KICKOFF_CAPABILITY/iu,
  /PI_SWARM_GROUP_SECRET/iu,
];

export type WorkerTaskProfile = "short" | "long" | "auto";
export type WorkerTaskStatus = "working" | "completed";
export type WorkerLineageState =
  | "working"
  | "handoff_pending"
  | "handoff_ready"
  | "replacing"
  | "retired"
  | "completed"
  | "failed";

export interface ContextRecyclingPolicyInput {
  taskProfile: WorkerTaskProfile;
  maxContextPercent?: number;
  maxReplacements?: number;
}

export interface ContextRecyclingPolicy {
  taskProfile: WorkerTaskProfile;
  maxContextPercent: number;
  maxReplacements: number;
}

export interface ContextRecyclingLaunch {
  lineageId: string;
  generation: number;
  replacementCount: number;
  policy: ContextRecyclingPolicy;
  /** Successors must prove this predecessor handoff is readable during session_start. */
  handoffPath?: string;
}

export interface WorkerLaunchSpecification {
  cwd: string;
  name?: string;
  color?: string;
  model?: string;
  allowRequests: boolean;
}

export interface WorkerContextMetric {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
  updatedAt: string;
}

export interface WorkerHandoffContent {
  originalObjective: string;
  currentState: string;
  completedWork: string;
  remainingWork: string;
  modifiedFiles: string;
  verification: string;
  decisions: string;
  blocker: string;
  nextAction: string;
  artifacts: string[];
}

export type WorkerLineage = {
  schemaVersion: 1;
  lineageId: string;
  projectRoot: string;
  leaderSessionId: string;
  workerSessionId?: string;
  successorSessionId?: string;
  originalObjective: string;
  taskProfile: WorkerTaskProfile;
  policy: ContextRecyclingPolicy;
  launch: WorkerLaunchSpecification;
  currentGeneration: number;
  replacementCount: number;
  state: WorkerLineageState;
  currentHandoffPath?: string;
  nextAction?: string;
  contextUsage?: WorkerContextMetric;
  updatedAt: string;
} & Record<string, unknown>;

export interface WorkerLineagePaths {
  root: string;
  lineageDirectory: string;
  lineagePath: string;
  handoffPath: string;
  artifactsDirectory: string;
}

export function normalizeContextRecyclingPolicy(input: unknown): ContextRecyclingPolicy {
  const value = record(input, "context recycling policy");
  assertKeys(value, ["taskProfile", "maxContextPercent", "maxReplacements"], "context recycling policy");
  if (typeof value.taskProfile !== "string" || !TASK_PROFILES.has(value.taskProfile)) {
    throw new Error("Pi Agent Swarm context recycling task profile is invalid");
  }
  const maxContextPercent = value.maxContextPercent ?? DEFAULT_MAX_CONTEXT_PERCENT;
  if (
    typeof maxContextPercent !== "number" ||
    !Number.isFinite(maxContextPercent) ||
    maxContextPercent <= 0 ||
    maxContextPercent > 100
  ) {
    throw new Error("Pi Agent Swarm context recycling percent must be greater than 0 and at most 100");
  }
  const maxReplacements = value.maxReplacements ?? DEFAULT_MAX_REPLACEMENTS;
  if (
    !Number.isInteger(maxReplacements) ||
    (maxReplacements as number) < 0 ||
    (maxReplacements as number) > MAX_REPLACEMENTS
  ) {
    throw new Error(`Pi Agent Swarm context recycling replacements must be an integer from 0 to ${MAX_REPLACEMENTS}`);
  }
  return {
    taskProfile: value.taskProfile as WorkerTaskProfile,
    maxContextPercent,
    maxReplacements: maxReplacements as number,
  };
}

export function contextHandoffDecision(
  percent: number | null | undefined,
  taskStatus: WorkerTaskStatus | undefined,
  threshold = DEFAULT_MAX_CONTEXT_PERCENT,
): "continue" | "complete" | "handoff" {
  if (percent === null || percent === undefined || percent < threshold) return "continue";
  return taskStatus === "completed" ? "complete" : "handoff";
}

export function workerLineagePaths(projectRoot: string, lineageId: string, generation: number): WorkerLineagePaths {
  if (!SAFE_LINEAGE_ID.test(lineageId)) throw new Error("Pi Agent Swarm lineage id is invalid");
  if (!Number.isInteger(generation) || generation < 1) throw new Error("Pi Agent Swarm lineage generation is invalid");
  const root = resolve(projectRoot);
  const storageRoot = resolve(root, WORKER_RECYCLING_DIRECTORY);
  if (storageRoot !== root && !storageRoot.startsWith(`${root}${sep}`)) {
    throw new Error("Pi Agent Swarm lineage storage escapes the project root");
  }
  const lineageDirectory = join(storageRoot, "lineages", lineageId);
  return {
    root: storageRoot,
    lineageDirectory,
    lineagePath: join(lineageDirectory, "lineage.json"),
    handoffPath: join(lineageDirectory, "generations", `${String(generation).padStart(4, "0")}-handoff.md`),
    artifactsDirectory: join(storageRoot, "artifacts", lineageId, String(generation).padStart(4, "0")),
  };
}

export async function verifyWorkerHandoffReadable(projectRoot: string, launch: ContextRecyclingLaunch): Promise<void> {
  if (launch.generation === 1) return;
  const expected = workerLineagePaths(projectRoot, launch.lineageId, launch.generation - 1).handoffPath;
  if (!launch.handoffPath || resolve(launch.handoffPath) !== expected) {
    throw new Error("Pi Agent Swarm successor handoff path does not match its predecessor generation");
  }
  const markdown = await readFile(expected, "utf8");
  const requiredSections = [
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
  if (requiredSections.some((section) => !markdown.includes(`## ${section}`))) {
    throw new Error("Pi Agent Swarm successor handoff is incomplete");
  }
}

export async function initializeWorkerLineage(options: {
  projectRoot: string;
  launch: ContextRecyclingLaunch;
  leaderSessionId: string;
  workerSessionId: string;
  specification: WorkerLaunchSpecification;
}): Promise<WorkerLineage> {
  return withLineageLock(options.projectRoot, options.launch.lineageId, async () => {
    const existing = await readWorkerLineageOptional(options.projectRoot, options.launch.lineageId);
    if (existing && existing.currentGeneration > options.launch.generation) return existing;
    const now = new Date().toISOString();
    const lineage: WorkerLineage = {
      ...(existing ?? {}),
      schemaVersion: 1,
      lineageId: options.launch.lineageId,
      projectRoot: resolve(options.projectRoot),
      leaderSessionId: options.leaderSessionId,
      workerSessionId: options.workerSessionId,
      originalObjective: existing?.originalObjective ?? "",
      taskProfile: options.launch.policy.taskProfile,
      policy: options.launch.policy,
      launch: options.specification,
      currentGeneration: options.launch.generation,
      replacementCount: options.launch.replacementCount,
      state: existing?.currentGeneration === options.launch.generation ? existing.state : "working",
      currentHandoffPath: options.launch.handoffPath ?? existing?.currentHandoffPath,
      nextAction: existing?.nextAction,
      updatedAt: now,
    };
    const paths = workerLineagePaths(options.projectRoot, options.launch.lineageId, options.launch.generation);
    await ensureStorageRoot(paths);
    await mkdir(paths.artifactsDirectory, { recursive: true, mode: 0o700 });
    await atomicJson(paths.lineagePath, lineage);
    return lineage;
  });
}

export async function readWorkerLineage(projectRoot: string, lineageId: string): Promise<WorkerLineage> {
  const paths = workerLineagePaths(projectRoot, lineageId, 1);
  const value = JSON.parse(await readFile(paths.lineagePath, "utf8")) as unknown;
  return validateWorkerLineage(value, projectRoot, lineageId);
}

export async function updateWorkerLineage(
  projectRoot: string,
  lineageId: string,
  patch: Record<string, unknown>,
  expected: { generation?: number; state?: WorkerLineageState } = {},
): Promise<WorkerLineage> {
  return withLineageLock(projectRoot, lineageId, async () => {
    const existing = await readWorkerLineage(projectRoot, lineageId);
    if (expected.generation !== undefined && existing.currentGeneration !== expected.generation) {
      throw new Error("Pi Agent Swarm worker lineage generation was superseded");
    }
    if (expected.state !== undefined && existing.state !== expected.state) {
      throw new Error("Pi Agent Swarm worker lineage state changed before its update");
    }
    const updated = validateWorkerLineage(
      { ...existing, ...patch, lineageId, projectRoot: resolve(projectRoot), updatedAt: new Date().toISOString() },
      projectRoot,
      lineageId,
    );
    await atomicJson(workerLineagePaths(projectRoot, lineageId, existing.currentGeneration).lineagePath, updated);
    return updated;
  });
}

export async function publishWorkerHandoff(options: {
  projectRoot: string;
  lineageId: string;
  generation: number;
  leaderSessionId: string;
  policy: ContextRecyclingPolicy;
  launch: WorkerLaunchSpecification;
  content: WorkerHandoffContent;
  nextAction: string;
}): Promise<WorkerLineagePaths> {
  return withLineageLock(options.projectRoot, options.lineageId, async () => {
    validateHandoff(options.content);
    const root = resolve(options.projectRoot);
    for (const artifact of options.content.artifacts) {
      if (!isWithin(root, resolve(root, artifact))) {
        throw new Error("Pi Agent Swarm handoff artifact is outside the project root");
      }
    }
    const paths = workerLineagePaths(options.projectRoot, options.lineageId, options.generation);
    const existing = await readWorkerLineageOptional(options.projectRoot, options.lineageId);
    if (
      existing &&
      (existing.currentGeneration > options.generation ||
        existing.state === "replacing" ||
        (existing.state === "working" && existing.currentHandoffPath !== paths.handoffPath))
    ) {
      throw new Error("Pi Agent Swarm handoff was superseded by a newer generation");
    }
    await ensureStorageRoot(paths);
    await mkdir(dirname(paths.handoffPath), { recursive: true, mode: 0o700 });
    await mkdir(paths.artifactsDirectory, { recursive: true, mode: 0o700 });
    await atomicText(paths.handoffPath, renderWorkerHandoff(options.content));
    const lineage = validateWorkerLineage(
      {
        ...(existing ?? {}),
        schemaVersion: 1,
        lineageId: options.lineageId,
        projectRoot: root,
        leaderSessionId: options.leaderSessionId,
        originalObjective: options.content.originalObjective,
        taskProfile: options.policy.taskProfile,
        policy: options.policy,
        launch: options.launch,
        currentGeneration: options.generation,
        replacementCount: existing?.replacementCount ?? Math.max(0, options.generation - 1),
        state: "handoff_ready",
        currentHandoffPath: paths.handoffPath,
        nextAction: options.nextAction,
        remainingWork: options.content.remainingWork,
        updatedAt: new Date().toISOString(),
      },
      options.projectRoot,
      options.lineageId,
    );
    await atomicJson(paths.lineagePath, lineage);
    return paths;
  });
}

export function renderWorkerHandoff(content: WorkerHandoffContent): string {
  validateHandoff(content);
  const sections: [string, string][] = [
    ["Original objective and constraints", content.originalObjective],
    ["Current state", content.currentState],
    ["Completed work", content.completedWork],
    ["Remaining work", content.remainingWork],
    ["Modified files and Git state", content.modifiedFiles],
    ["Verification performed and its results", content.verification],
    ["Key decisions and their rationale", content.decisions],
    ["Current problem or blocker", content.blocker],
    ["Exact next action", content.nextAction],
    ["Required project files and artifact paths", content.artifacts.length > 0 ? content.artifacts.join("\n") : "None"],
  ];
  return `# Worker handoff\n\n${sections.map(([title, body]) => `## ${title}\n\n${body.trim() || "None"}`).join("\n\n")}\n`;
}

function validateHandoff(content: WorkerHandoffContent): void {
  const value = record(content, "worker handoff");
  for (const key of [
    "originalObjective",
    "currentState",
    "completedWork",
    "remainingWork",
    "modifiedFiles",
    "verification",
    "decisions",
    "blocker",
    "nextAction",
  ]) {
    if (typeof value[key] !== "string" || Buffer.byteLength(value[key], "utf8") > 8192) {
      throw new Error(`Pi Agent Swarm worker handoff ${key} is invalid`);
    }
  }
  if (
    !Array.isArray(value.artifacts) ||
    value.artifacts.length > 32 ||
    value.artifacts.some((item) => typeof item !== "string")
  ) {
    throw new Error("Pi Agent Swarm worker handoff artifacts are invalid");
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > 40 * 1024) throw new Error("Pi Agent Swarm worker handoff is too large");
  if (SECRET_PATTERNS.some((pattern) => pattern.test(serialized))) {
    throw new Error("Pi Agent Swarm worker handoff must not contain secret material");
  }
}

async function readWorkerLineageOptional(projectRoot: string, lineageId: string): Promise<WorkerLineage | undefined> {
  try {
    return await readWorkerLineage(projectRoot, lineageId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

async function ensureStorageRoot(paths: WorkerLineagePaths): Promise<void> {
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  try {
    await writeFile(join(paths.root, ".gitignore"), "*\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

async function withLineageLock<T>(projectRoot: string, lineageId: string, callback: () => Promise<T>): Promise<T> {
  const lockPath = `${workerLineagePaths(projectRoot, lineageId, 1).lineagePath}.lock`;
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  for (let attempt = 0; attempt < 200 && !handle; attempt += 1) {
    try {
      handle = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const lockStat = await stat(lockPath).catch(() => undefined);
      if (lockStat && Date.now() - lockStat.mtimeMs > 30_000) await rm(lockPath, { force: true });
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
    }
  }
  if (!handle) throw new Error("Pi Agent Swarm worker lineage is busy with another update");
  try {
    return await callback();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

function validateWorkerLineage(value: unknown, projectRoot: string, lineageId: string): WorkerLineage {
  const lineage = record(value, "worker lineage");
  if (lineage.schemaVersion !== 1 || lineage.lineageId !== lineageId || lineage.projectRoot !== resolve(projectRoot)) {
    throw new Error("Pi Agent Swarm worker lineage identity is invalid");
  }
  if (typeof lineage.leaderSessionId !== "string" || typeof lineage.originalObjective !== "string") {
    throw new Error("Pi Agent Swarm worker lineage ownership is invalid");
  }
  if (!Number.isInteger(lineage.currentGeneration) || (lineage.currentGeneration as number) < 1) {
    throw new Error("Pi Agent Swarm worker lineage generation is invalid");
  }
  if (!Number.isInteger(lineage.replacementCount) || (lineage.replacementCount as number) < 0) {
    throw new Error("Pi Agent Swarm worker lineage replacement count is invalid");
  }
  if (typeof lineage.state !== "string" || !LINEAGE_STATES.has(lineage.state)) {
    throw new Error("Pi Agent Swarm worker lineage state is invalid");
  }
  const policy = normalizeContextRecyclingPolicy(lineage.policy);
  if (
    (lineage.replacementCount as number) !== (lineage.currentGeneration as number) - 1 ||
    (lineage.replacementCount as number) > policy.maxReplacements
  ) {
    throw new Error("Pi Agent Swarm worker lineage replacement budget is invalid");
  }
  const launch = record(lineage.launch, "worker lineage launch");
  assertKeys(launch, ["cwd", "name", "color", "model", "allowRequests"], "worker lineage launch");
  if (
    typeof launch.cwd !== "string" ||
    resolve(launch.cwd) !== resolve(projectRoot) ||
    typeof launch.allowRequests !== "boolean"
  ) {
    throw new Error("Pi Agent Swarm worker lineage launch is invalid");
  }
  for (const key of ["name", "color", "model"] as const) {
    if (
      launch[key] !== undefined &&
      (typeof launch[key] !== "string" || Buffer.byteLength(launch[key], "utf8") > 4_096)
    ) {
      throw new Error(`Pi Agent Swarm worker lineage launch ${key} is invalid`);
    }
  }
  if (lineage.currentHandoffPath !== undefined) {
    const handoffPath = resolve(String(lineage.currentHandoffPath));
    const generations = join(workerLineagePaths(projectRoot, lineageId, 1).lineageDirectory, "generations");
    if (
      !isWithin(generations, handoffPath) ||
      !/^\d{4}-handoff\.md$/u.test(handoffPath.slice(generations.length + 1))
    ) {
      throw new Error("Pi Agent Swarm worker lineage handoff path is invalid");
    }
  }
  for (const key of ["workerSessionId", "successorSessionId", "leaderSessionId"] as const) {
    if (typeof lineage[key] !== "string" || Buffer.byteLength(lineage[key], "utf8") > 256) {
      if (key !== "leaderSessionId" && lineage[key] === undefined) continue;
      throw new Error(`Pi Agent Swarm worker lineage ${key} is invalid`);
    }
  }
  if (typeof lineage.updatedAt !== "string") throw new Error("Pi Agent Swarm worker lineage update time is invalid");
  return { ...lineage, policy, launch } as unknown as WorkerLineage;
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value, null, 2);
  if (SECRET_PATTERNS.some((pattern) => pattern.test(serialized))) {
    throw new Error("Pi Agent Swarm worker lineage must not contain secret material");
  }
  await atomicText(path, `${serialized}\n`);
}

async function atomicText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    await rename(temporary, path);
  } catch (error) {
    const { rm } = await import("node:fs/promises");
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Pi Agent Swarm ${label} must be an object`);
  return value as Record<string, unknown>;
}

function assertKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`Pi Agent Swarm ${label} has unknown field ${unknown}`);
}
