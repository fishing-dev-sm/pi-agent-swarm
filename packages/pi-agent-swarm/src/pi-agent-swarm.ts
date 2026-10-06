import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SwarmMenuSource } from "./menu.js";
import { parseInvite } from "./protocol.js";
import { renderSwarmMessage, SWARM_MESSAGE_TYPE } from "./renderer.js";
import { createSwarmSettingsRuntime, type SwarmSettingsRuntime } from "./settings.js";
import { SwarmController, type SwarmControllerDependencies } from "./swarm-controller.js";
import { safeTerminalLine } from "./text.js";
import { registerSwarmTools } from "./tools.js";

const USAGE = "Usage: /swarm, /swarm start, or /swarm <piagentswarm:v1:invite>";

type SwarmMenuModule = Pick<typeof import("./menu.js"), "showSwarmMenu">;

export interface PiSwarmDependencies {
  controllerDependencies?: SwarmControllerDependencies;
  settingsRuntime?: SwarmSettingsRuntime;
  loadMenu?: () => Promise<SwarmMenuModule>;
}

export function createPiSwarmExtension(dependencies: PiSwarmDependencies = {}): (pi: ExtensionAPI) => void {
  return function piSwarmExtension(pi: ExtensionAPI): void {
    const settings = dependencies.settingsRuntime ?? createSwarmSettingsRuntime();
    const controller = new SwarmController(pi, dependencies.controllerDependencies, settings);
    const loadMenu = cachedModuleLoader(dependencies.loadMenu ?? (() => import("./menu.js")));

    pi.registerMessageRenderer(SWARM_MESSAGE_TYPE, renderSwarmMessage);
    registerSwarmTools(pi, controller);

    pi.on("session_start", async (event, ctx) => {
      await controller.sessionStart(event, ctx);
    });
    pi.on("session_shutdown", async (event, ctx) => {
      await controller.sessionShutdown(event, ctx);
    });
    pi.on("input", async (event, ctx) => {
      if (event.source !== "interactive") return;
      void controller.relaySteerInput(event.text, ctx);
    });

    pi.registerCommand("swarm", {
      description: "Spawn a worker Pi session, or start/join a local group",
      handler: async (rawArgs, ctx) => {
        const args = rawArgs.trim();
        if (ctx.mode !== "tui" && ctx.mode !== "rpc") {
          throw new Error(`Pi Agent Swarm is unavailable in ${ctx.mode} mode. ${USAGE}`);
        }
        if (args === "start") {
          await startGroupDirectly(controller, ctx);
          return;
        }
        if (args) {
          await joinDirectInvite(controller, args, ctx);
          return;
        }
        const ownerSignal = controller.sessionSignal;
        const menuModule = await loadMenu();
        if (ownerSignal.aborted || !controller.isCurrent(ctx)) return;
        await menuModule.showSwarmMenu(ctx, menuSource(controller), {
          signal: ownerSignal,
          isCurrent: () => controller.isCurrent(ctx) && !ownerSignal.aborted,
        });
      },
    });

    pi.registerCommand("lead", {
      description: "Set the swarm lead (coordinator) by session name or id",
      handler: async (rawArgs, ctx) => {
        const target = rawArgs.trim();
        if (!target) throw new Error("Usage: /lead <session name or id>");
        const signal = controller.sessionSignal;
        const peer = await controller.resolvePeer(target, signal);
        if (!peer) throw new Error(`No live Pi Agent Swarm session matches "${target}"`);
        await controller.setLead(ctx, peer, signal);
        ctx.ui.notify(`Lead is now ${peer.name ?? peer.sessionId}.`, "info");
      },
    });

    pi.registerCommand("color", {
      description: "Set this session's color (palette name or #rrggbb)",
      handler: async (rawArgs, ctx) => {
        const color = controller.normalizeColor(rawArgs.trim());
        if (!color) {
          throw new Error("Usage: /color <red|orange|yellow|green|cyan|blue|magenta|purple|#rrggbb>");
        }
        await controller.setOwnColor(ctx, color);
        ctx.ui.notify(`Color set to ${color}.`, "info");
      },
    });
  };
}

async function joinDirectInvite(
  controller: SwarmController,
  invite: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  try {
    parseInvite(invite);
  } catch {
    throw new Error(USAGE);
  }
  const signal = controller.sessionSignal;
  if (signal.aborted) return;
  const confirmed = await ctx.ui.confirm(
    "Join local Pi Agent Swarm group?",
    "The bearer invite permits local peer messages. Incoming agent requests start blocked.",
    { signal },
  );
  if (!confirmed || signal.aborted || !controller.isCurrent(ctx)) return;
  await controller.joinInvite(ctx, invite, false, signal);
  if (controller.isCurrent(ctx)) {
    ctx.ui.notify("Joined the local Pi Agent Swarm group.", "info");
  }
}

async function startGroupDirectly(controller: SwarmController, ctx: ExtensionCommandContext): Promise<void> {
  const signal = controller.sessionSignal;
  if (signal.aborted) return;
  await controller.startNewGroup(ctx, false, signal);
  if (controller.isCurrent(ctx)) {
    ctx.ui.notify("Started a local Pi Agent Swarm group. You are its lead.", "info");
  }
}

function menuSource(controller: SwarmController): SwarmMenuSource {
  return {
    snapshot: (signal) => controller.snapshot(signal),
    spawn: async (commandContext, input, signal) => {
      const result = await controller.spawn(commandContext, input, signal);
      if (controller.isCurrent(commandContext)) {
        commandContext.ui.notify(
          `Pi session ${safeTerminalLine(result.name ?? result.sessionId)} is ready in an external window.`,
          "info",
        );
      }
    },
    rename: async (commandContext, name, signal) => {
      await controller.setOwnName(commandContext, name, signal);
      if (controller.isCurrent(commandContext)) {
        commandContext.ui.notify(`Session renamed to ${safeTerminalLine(name)}.`, "info");
      }
    },
    setColor: async (commandContext, color, signal) => {
      const normalized = controller.normalizeColor(color);
      if (!normalized) throw new Error("Pi Agent Swarm color is invalid");
      await controller.setOwnColor(commandContext, normalized, signal);
      if (controller.isCurrent(commandContext)) {
        commandContext.ui.notify(`Color set to ${normalized}.`, "info");
      }
    },
    setPalette: async (commandContext, palette, signal) => {
      await controller.setColorPalette(commandContext, palette, signal);
      if (controller.isCurrent(commandContext)) {
        commandContext.ui.notify(`Theme set to ${palette}.`, "info");
      }
    },
  };
}

function cachedModuleLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | undefined;
  return async () => {
    if (!cached) {
      cached = load().catch((error) => {
        cached = undefined;
        throw error;
      });
    }
    return cached;
  };
}

export default createPiSwarmExtension();
