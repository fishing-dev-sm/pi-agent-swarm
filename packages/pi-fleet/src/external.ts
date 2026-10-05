import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { TerminalSplitDirection } from "./terminal.js";

/**
 * fleet/external — launch a Pi session in a plain terminal window.
 *
 * The window manager (i3, Sway, or a desktop shell) decides where the new
 * window goes, so there is no split direction and no multiplexer to talk to.
 * The launch environment is embedded in the launcher script by the controller,
 * exactly like the Zellij path, because a bare terminal emulator has no
 * per-window `-e KEY=VAL` flags.
 */
export class ExternalLaunchError extends Error {
  constructor(
    message: string,
    readonly splitCreated = false,
    readonly terminalId?: string,
  ) {
    super(message);
    this.name = "ExternalLaunchError";
  }
}

export interface SpawnExternalWindowOptions {
  direction: TerminalSplitDirection;
  cwd: string;
  launcherCommand: string;
  environment: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  isCurrent(): boolean;
}

/** Split a settings value such as `"alacritty -e"` into `["alacritty", "-e"]`. */
export function parseExternalCommand(value: string): string[] {
  return value.trim().split(/\s+/u).filter(Boolean);
}

export class ExternalTerminalAdapter {
  constructor(private readonly command: readonly string[]) {}

  async assertAvailable(signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal, "external terminal availability check aborted");
    const binary = this.command[0];
    if (!binary) throw new ExternalLaunchError("Pi Fleet external terminal command is empty");
    if (!isOnPath(binary)) {
      throw new ExternalLaunchError(`Pi Fleet external terminal "${binary}" was not found on PATH`);
    }
    return binary;
  }

  async spawnSplit(options: SpawnExternalWindowOptions): Promise<{ terminalId: string; version: string }> {
    throwIfAborted(options.signal, "external window creation aborted");
    validateSpawnOptions(options);
    const binary = await this.assertAvailable(options.signal);
    if (!options.isCurrent()) {
      throw new ExternalLaunchError("Pi Fleet session became stale before window creation");
    }
    throwIfAborted(options.signal, "external window creation aborted");
    let pid: number | undefined;
    try {
      const child = spawn(binary, [...this.command.slice(1), options.launcherCommand], {
        cwd: options.cwd,
        detached: true,
        stdio: "ignore",
      });
      pid = child.pid;
      // The window outlives the extension. Failures surface indirectly: the
      // child never announces itself and the controller's readiness wait fails.
      child.on("error", () => undefined);
      child.unref();
    } catch (error) {
      if (options.signal?.aborted) {
        throw new ExternalLaunchError("external window creation was cancelled", true);
      }
      throw error;
    }
    if (options.signal?.aborted) {
      throw new ExternalLaunchError(
        "external window was created after cancellation",
        true,
        pid ? String(pid) : undefined,
      );
    }
    if (!options.isCurrent()) {
      throw new ExternalLaunchError(
        "Pi Fleet session became stale after window creation",
        true,
        pid ? String(pid) : undefined,
      );
    }
    return { terminalId: pid ? String(pid) : "unknown", version: binary };
  }
}

function validateSpawnOptions(options: SpawnExternalWindowOptions): void {
  for (const [label, value, maxBytes] of [
    ["working directory", options.cwd, 4_096],
    ["launcher command", options.launcherCommand, 4_096],
  ] as const) {
    if (!value || value.includes("\0") || Buffer.byteLength(value) > maxBytes) {
      throw new ExternalLaunchError(`Pi Fleet ${label} is invalid`);
    }
  }
}

function isOnPath(binary: string): boolean {
  if (binary.includes("/")) return existsSync(binary);
  const path = process.env.PATH ?? "";
  for (const dir of path.split(":")) {
    if (dir && existsSync(join(dir, binary))) return true;
  }
  return false;
}

function throwIfAborted(signal: AbortSignal | undefined, message: string): void {
  if (!signal?.aborted) return;
  const error = new Error(message);
  error.name = "AbortError";
  throw error;
}
