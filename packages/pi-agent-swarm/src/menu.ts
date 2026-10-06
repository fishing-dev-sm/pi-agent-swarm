import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { MenuDefinition } from "@narumitw/pi-tui-kit";
import { SWARM_COLORS } from "./color.js";
import type { SpawnSessionInput, SwarmSnapshot } from "./swarm-controller.js";
import { safeError } from "./text.js";

export interface SwarmMenuState extends SwarmSnapshot {}

export interface SwarmMenuSource {
  snapshot(signal?: AbortSignal): Promise<SwarmMenuState>;
  spawn(ctx: ExtensionCommandContext, input: SpawnSessionInput, signal?: AbortSignal): Promise<void>;
  rename(ctx: ExtensionCommandContext, name: string, signal?: AbortSignal): Promise<void>;
  setColor(ctx: ExtensionCommandContext, color: string, signal?: AbortSignal): Promise<void>;
}

type Screen = "main";
type Action = "spawn" | "rename" | "setColor";

const DIRECTION_OPTIONS = ["Right", "Down", "Left", "Up"] as const;

export function createSwarmMenu(source: SwarmMenuSource) {
  const getState = ({ signal }: { signal?: AbortSignal } = {}) => source.snapshot(signal);
  const menu: MenuDefinition<SwarmMenuState, Screen, Action> = {
    start: "main",
    screens: {
      main: () => ({
        kind: "actions",
        title: "Pi Agent Swarm",
        lines: ["Spawn workers and manage this session's badge."],
        items: [
          {
            id: "spawn",
            label: "Spawn",
            action: "spawn",
          },
          {
            id: "rename",
            label: "Rename",
            action: "rename",
          },
          {
            id: "color",
            label: "Set color",
            action: "setColor",
          },
        ],
        hint: "close",
      }),
    },
    actions: {
      spawn: async ({ ctx, signal }) => {
        const directionChoice = await ctx.ui.select("Terminal window direction", [...DIRECTION_OPTIONS], {
          signal,
        });
        if (!directionChoice || signal.aborted) return { kind: "stay" };
        const task = await ctx.ui.input("Optional first task", "Submit an empty value for an idle child session", {
          signal,
        });
        if (task === undefined || signal.aborted) return { kind: "stay" };
        await source.spawn(
          ctx,
          {
            direction: directionChoice.toLowerCase() as SpawnSessionInput["direction"],
            ...(task ? { task } : {}),
          },
          signal,
        );
        return { kind: "close" };
      },
      rename: async ({ ctx, signal, state }) => {
        const name = await ctx.ui.input("Rename session", state.self?.name ?? "Enter a new session name", {
          signal,
        });
        if (name === undefined || !name.trim() || signal.aborted) return { kind: "stay" };
        await source.rename(ctx, name, signal);
        return { kind: "stay" };
      },
      setColor: async ({ ctx, signal }) => {
        const choice = await ctx.ui.select("Session color", [...SWARM_COLORS.map((color) => color.name)], {
          signal,
        });
        if (!choice || signal.aborted) return { kind: "stay" };
        await source.setColor(ctx, choice, signal);
        return { kind: "stay" };
      },
    },
  };
  return { menu, getState };
}

export async function showSwarmMenu(
  ctx: ExtensionCommandContext,
  source: SwarmMenuSource,
  ownership: { signal: AbortSignal; isCurrent(): boolean },
): Promise<void> {
  const { runMenu } = await import("@narumitw/pi-tui-kit");
  if (ownership.signal.aborted || !ownership.isCurrent()) return;
  const controller = createSwarmMenu(source);
  await runMenu(ctx, controller.menu, {
    getState: controller.getState,
    signal: ownership.signal,
    isCurrent: ownership.isCurrent,
    onError: (_ctx, error) => {
      if (ownership.isCurrent() && !ownership.signal.aborted) {
        ctx.ui.notify(`Pi Agent Swarm failed: ${safeError(error)}`, "error");
      }
    },
  });
}
