import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ExternalLaunchError, ExternalTerminalAdapter } from "./external.js";
import { detectI3, I3WorkspacePinner } from "./i3-workspace.js";

export type TerminalSplitDirection = "right" | "down" | "left" | "up";

export interface SwarmTerminalPort {
  assertAvailable(signal?: AbortSignal): Promise<string>;
  spawnSplit(options: {
    direction: TerminalSplitDirection;
    cwd: string;
    launcherCommand: string;
    environment: Readonly<Record<string, string>>;
    signal?: AbortSignal;
    isCurrent(): boolean;
  }): Promise<{ terminalId: string; version: string }>;
}

export function createDefaultTerminalPort(
  pi: ExtensionAPI,
  externalCommand?: readonly string[],
  pinToLeadWorkspace = false,
): SwarmTerminalPort {
  const options = {
    execute: async (
      command: string,
      args: string[],
      execution: {
        signal?: AbortSignal;
        timeoutMs: number;
      },
    ) =>
      pi.exec(command, args, {
        ...(execution.signal ? { signal: execution.signal } : {}),
        timeout: execution.timeoutMs,
      }),
  };
  return new ExternalTerminalAdapter(
    externalCommand ?? ["alacritty", "-e"],
    pinToLeadWorkspace && detectI3(process.env) ? new I3WorkspacePinner(options) : undefined,
  );
}

export function isTerminalLaunchError(error: unknown): error is ExternalLaunchError {
  return error instanceof ExternalLaunchError;
}

export function createTerminalLaunchError(
  message: string,
  splitCreated: boolean,
  terminalId?: string,
): ExternalLaunchError {
  return new ExternalLaunchError(message, splitCreated, terminalId);
}
