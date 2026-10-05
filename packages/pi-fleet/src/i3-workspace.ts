/**
 * fleet/i3-workspace — pin a newly spawned external window to the lead session's
 * i3 workspace.
 *
 * The external terminal backend spawns a plain terminal window and normally lets
 * the window manager decide where it goes. On i3 that means the currently focused
 * workspace, which is not necessarily the workspace that hosts the lead (spawning)
 * Pi session once focus-follows-mouse, a quick workspace switch, or a headless
 * tool-triggered launch is involved.
 *
 * The lead workspace is located by walking the process tree from the current Pi
 * process up to the terminal process that owns the X11 window (`_NET_WM_PID`), not
 * by trusting the focused workspace. The pinner then snapshots the window tree,
 * waits for the one new window id to appear, and moves that container onto the lead
 * workspace. It talks to `i3-msg` and `xprop`, so it never depends on a specific
 * terminal emulator or its command-line flags.
 */

import { readFileSync } from "node:fs";

export interface I3CommandResult {
  stdout: string;
  stderr: string;
  code: number;
  killed?: boolean;
}

export type I3CommandExecutor = (
  command: string,
  args: string[],
  options: { signal?: AbortSignal; timeoutMs: number },
) => Promise<I3CommandResult>;

export interface I3WorkspacePinnerOptions {
  execute: I3CommandExecutor;
  readProcessId?: () => number;
  readPpid?: (pid: number) => number | undefined;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

interface I3TreeNode {
  id: number;
  type?: string;
  name?: string | null;
  window?: number | null;
  nodes?: I3TreeNode[];
  floating_nodes?: I3TreeNode[];
}

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const MAX_ANCESTOR_DEPTH = 8;

/** Detect an i3 session from the standard `I3SOCK` and X11 `DISPLAY` variables. */
export function detectI3(environment: NodeJS.ProcessEnv): boolean {
  return (
    typeof environment.I3SOCK === "string" &&
    environment.I3SOCK.length > 0 &&
    typeof environment.DISPLAY === "string" &&
    environment.DISPLAY.length > 0
  );
}

export class I3WorkspacePinner {
  private readonly execute: I3CommandExecutor;
  private readonly readProcessId: () => number;
  private readonly readPpid: (pid: number) => number | undefined;
  private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private beforeWindowIds: Set<number> | undefined;

  constructor(options: I3WorkspacePinnerOptions) {
    this.execute = options.execute;
    this.readProcessId = options.readProcessId ?? (() => process.pid);
    this.readPpid = options.readPpid ?? readProcPpid;
    this.sleep = options.sleep ?? abortableSleep;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  /**
   * Snapshot the tree before the new window is created and return the workspace
   * that hosts this Pi session's terminal window, located by `_NET_WM_PID` and the
   * process tree rather than by the currently focused workspace.
   */
  async captureLeadWorkspace(signal?: AbortSignal): Promise<string> {
    const tree = await this.getTree(signal);
    this.beforeWindowIds = collectWindowIds(tree);
    const workspace = await this.findSelfWorkspace(tree, signal);
    if (!workspace) throw new Error("Pi Fleet could not locate the lead session's i3 workspace");
    return workspace;
  }

  /**
   * Wait for the one new window to appear and move it onto the captured lead
   * workspace. Best-effort callers catch failures; the window is already open.
   */
  async pinNewWindowToLeadWorkspace(leadWorkspace: string, signal?: AbortSignal): Promise<void> {
    const before = this.beforeWindowIds;
    if (!before) throw new Error("Pi Fleet must capture the lead workspace before pinning a window");
    const deadline = this.now() + this.timeoutMs;
    while (true) {
      throwIfAborted(signal, "Pi Fleet i3 workspace pin was aborted");
      const tree = await this.getTree(signal);
      const conId = findNewWindowId(tree, before);
      if (conId !== undefined) {
        await this.moveToWorkspace(conId, leadWorkspace, signal);
        return;
      }
      if (this.now() >= deadline) {
        throw new Error("Pi Fleet timed out waiting for the new window to appear");
      }
      await this.sleep(this.pollIntervalMs, signal);
    }
  }

  private async findSelfWorkspace(tree: I3TreeNode, signal?: AbortSignal): Promise<string | undefined> {
    const ancestors = collectAncestors(this.readProcessId(), this.readPpid);
    for (const node of windowNodes(tree)) {
      const ownerPid = await this.xpropPid(node.window as number, signal);
      if (ownerPid !== undefined && ancestors.includes(ownerPid)) {
        return workspaceOf(tree, node.id);
      }
    }
    return undefined;
  }

  private async xpropPid(windowId: number, signal?: AbortSignal): Promise<number | undefined> {
    let result: I3CommandResult;
    try {
      result = await this.execute("xprop", ["-id", String(windowId), "_NET_WM_PID"], {
        ...(signal ? { signal } : {}),
        timeoutMs: this.timeoutMs,
      });
    } catch {
      return undefined;
    }
    if (result.code !== 0 || result.killed) return undefined;
    const match = /_NET_WM_PID[^=]*=\s*(\d+)/u.exec(result.stdout);
    return match ? Number(match[1]) : undefined;
  }

  private async getTree(signal?: AbortSignal): Promise<I3TreeNode> {
    const result = await this.execute("i3-msg", ["-t", "get_tree"], {
      ...(signal ? { signal } : {}),
      timeoutMs: this.timeoutMs,
    });
    if (result.code !== 0 || result.killed) {
      throw new Error("Pi Fleet could not query the i3 window tree");
    }
    try {
      return JSON.parse(result.stdout) as I3TreeNode;
    } catch {
      throw new Error("Pi Fleet received an invalid i3 window tree");
    }
  }

  private async moveToWorkspace(conId: number, workspace: string, signal?: AbortSignal): Promise<void> {
    const result = await this.execute(
      "i3-msg",
      [`[con_id=${conId}] move container to workspace ${quoteI3Value(workspace)}`],
      {
        ...(signal ? { signal } : {}),
        timeoutMs: this.timeoutMs,
      },
    );
    if (result.code !== 0 || result.killed) {
      throw new Error("Pi Fleet could not move the new window to the lead workspace");
    }
  }
}

function collectWindowIds(tree: I3TreeNode): Set<number> {
  const ids = new Set<number>();
  visit(tree, (node) => {
    if (typeof node.window === "number") ids.add(node.window);
  });
  return ids;
}

function windowNodes(tree: I3TreeNode): I3TreeNode[] {
  const nodes: I3TreeNode[] = [];
  visit(tree, (node) => {
    if (typeof node.window === "number") nodes.push(node);
  });
  return nodes;
}

function findNewWindowId(tree: I3TreeNode, before: Set<number>): number | undefined {
  let found: number | undefined;
  visit(tree, (node) => {
    if (found !== undefined) return;
    if (typeof node.window === "number" && !before.has(node.window)) {
      found = node.id;
    }
  });
  return found;
}

function workspaceOf(tree: I3TreeNode, conId: number): string | undefined {
  let found: string | undefined;
  visit(tree, (node, workspaceName) => {
    if (found !== undefined) return;
    const current = node.type === "workspace" && typeof node.name === "string" ? node.name : workspaceName;
    if (node.id === conId) found = current;
  });
  return found;
}

function visit(node: I3TreeNode, callback: (node: I3TreeNode, workspaceName: string | undefined) => void): void {
  const walk = (current: I3TreeNode, workspaceName: string | undefined): void => {
    const nextWorkspace =
      current.type === "workspace" && typeof current.name === "string" ? current.name : workspaceName;
    callback(current, nextWorkspace);
    for (const child of [...(current.nodes ?? []), ...(current.floating_nodes ?? [])]) {
      walk(child, nextWorkspace);
    }
  };
  walk(node, undefined);
}

function collectAncestors(pid: number, readPpid: (pid: number) => number | undefined): number[] {
  const ancestors = [pid];
  let current = pid;
  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    const parent = readPpid(current);
    if (parent === undefined || parent <= 1) break;
    ancestors.push(parent);
    current = parent;
  }
  return ancestors;
}

function readProcPpid(pid: number): number | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    if (close < 0) return undefined;
    const fields = stat.slice(close + 2).split(" ");
    const ppid = Number(fields[1]);
    return Number.isInteger(ppid) && ppid > 0 ? ppid : undefined;
  } catch {
    return undefined;
  }
}

function quoteI3Value(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

async function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal, "Pi Fleet i3 workspace wait was aborted");
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(), milliseconds);
    const abort = () => finish(abortError("Pi Fleet i3 workspace wait was aborted"));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function throwIfAborted(signal: AbortSignal | undefined, message: string): void {
  if (signal?.aborted) throw abortError(message);
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}
