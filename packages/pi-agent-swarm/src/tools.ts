import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { swarmColorName } from "./color.js";
import type { WorkerHandoffContent, WorkerTaskStatus } from "./context-recycling.js";
import type { SwarmMessage } from "./protocol.js";
import type { SpawnSessionInput, SpawnSessionResult, SwarmSnapshot } from "./swarm-controller.js";
import { safeTerminalLine } from "./text.js";
import type { SwarmDeliveryAck } from "./transport.js";

const DIRECTIONS = ["right", "down", "left", "up"] as const;
const BUS_ACTIONS = ["list", "send", "reply", "shutdown", "handoff"] as const;
const SEND_MODES = ["notify", "request"] as const;
const MAX_LISTED_PEERS = 64;
const MAX_LIST_RESULT_BYTES = 40 * 1024;

export interface SwarmToolController {
  spawn(ctx: ExtensionContext, input: SpawnSessionInput, signal?: AbortSignal): Promise<SpawnSessionResult>;
  snapshot(signal?: AbortSignal): Promise<SwarmSnapshot>;
  send(
    ctx: ExtensionContext,
    options: {
      targetSessionId: string;
      text: string;
      mode: "notify" | "request" | "reply";
      replyTo?: string;
      taskStatus?: WorkerTaskStatus;
      handoff?: WorkerHandoffContent;
    },
    signal?: AbortSignal,
  ): Promise<{ message: SwarmMessage; acknowledgement: SwarmDeliveryAck }>;
  shutdownPeer(
    ctx: ExtensionContext,
    targetSessionId: string,
    signal?: AbortSignal,
  ): Promise<{ message: SwarmMessage; acknowledgement: SwarmDeliveryAck }>;
  publishHandoff(
    ctx: ExtensionContext,
    handoff: WorkerHandoffContent,
    signal?: AbortSignal,
  ): Promise<{ handoffPath: string }>;
}

const handoffSchema = Type.Object(
  {
    originalObjective: Type.String({ maxLength: 8_192 }),
    currentState: Type.String({ maxLength: 8_192 }),
    completedWork: Type.String({ maxLength: 8_192 }),
    remainingWork: Type.String({ maxLength: 8_192 }),
    modifiedFiles: Type.String({ maxLength: 8_192 }),
    verification: Type.String({ maxLength: 8_192 }),
    decisions: Type.String({ maxLength: 8_192 }),
    blocker: Type.String({ maxLength: 8_192 }),
    nextAction: Type.String({ maxLength: 8_192 }),
    artifacts: Type.Array(Type.String({ maxLength: 4_096 }), { maxItems: 32 }),
  },
  { additionalProperties: false },
);

const spawnSchema = Type.Object(
  {
    direction: Type.Optional(StringEnum(DIRECTIONS, { description: "Terminal window direction" })),
    allowRequests: Type.Optional(
      Type.Boolean({
        description:
          "Allow trusted peers to request follow-up turns in the child after its initial task; defaults to false. This can incur model charges and concurrent workspace edits.",
      }),
    ),
    contextRecycling: Type.Optional(
      Type.Object(
        {
          taskProfile: Type.Union([Type.Literal("short"), Type.Literal("long"), Type.Literal("auto")], {
            description: "Leader's assessment of the assignment duration",
          }),
          maxContextPercent: Type.Optional(
            Type.Number({
              description: "Soft handoff threshold; defaults to 50 and never aborts the current turn",
              minimum: 1,
              maximum: 100,
            }),
          ),
          maxReplacements: Type.Optional(
            Type.Integer({
              description: "Maximum authorized automatic successors; defaults to 3, maximum 10",
              minimum: 0,
              maximum: 10,
            }),
          ),
        },
        {
          additionalProperties: false,
          description:
            "Authorize bounded automatic worker replacement after a stable-boundary handoff. Omit to disable recycling.",
        },
      ),
    ),
    task: Type.Optional(
      Type.String({
        description: "Optional first task sent after child readiness",
        maxLength: 16_384,
      }),
    ),
    name: Type.Optional(Type.String({ description: "Optional child Pi session name", maxLength: 200 })),
    color: Type.Optional(
      Type.String({
        description:
          "Optional child color: a palette name (red, orange, yellow, green, cyan, blue, magenta, purple) or a #rrggbb hex",
        maxLength: 32,
      }),
    ),
    model: Type.Optional(
      Type.String({
        description:
          "Optional child model as provider/id (e.g. deepseek/deepseek-v4-pro, kimi-coding/k3); defaults to inheriting the current session model",
        maxLength: 200,
      }),
    ),
    cwd: Type.Optional(
      Type.String({
        description: "Existing child working directory, defaulting to the current cwd",
        maxLength: 4_096,
      }),
    ),
  },
  { additionalProperties: false },
);

const busSchema = Type.Object(
  {
    action: StringEnum(BUS_ACTIONS, {
      description: "List sessions, send a message, reply, or request a graceful shutdown",
    }),
    targetSessionId: Type.Optional(
      Type.String({ description: "Destination Pi session id", minLength: 1, maxLength: 128 }),
    ),
    message: Type.Optional(Type.String({ description: "Message or request body", maxLength: 16_384 })),
    mode: Type.Optional(StringEnum(SEND_MODES, { description: "Notify without a turn or request one turn" })),
    replyTo: Type.Optional(
      Type.String({ description: "Original message id for a reply", minLength: 1, maxLength: 128 }),
    ),
    taskStatus: Type.Optional(
      Type.Union([Type.Literal("working"), Type.Literal("completed")], {
        description: "Worker task state for context recycling; completed prevents successor creation",
      }),
    ),
    handoff: Type.Optional(handoffSchema),
  },
  { additionalProperties: false },
);

export function registerSwarmTools(pi: ExtensionAPI, controller: SwarmToolController): void {
  pi.registerTool({
    name: "session_spawn",
    label: "Spawn Pi Session",
    description:
      "Create a separate Pi process in an external terminal window, wait for authenticated readiness, and optionally send its first task. This preserves the current session and follows the configured launch-confirmation policy.",
    promptSnippet: "Start a collaborating Pi session in an external terminal window",
    promptGuidelines: [
      "Use session_spawn only when the user explicitly asks to open or start another Pi session.",
      "Do not claim the child is ready until session_spawn returns authenticated readiness metadata.",
      "Use allowRequests only when the user wants this worker to accept follow-up tasks in the same session; it defaults to false.",
      "Use contextRecycling only with explicit user authorization for bounded automatic worker replacement; the threshold is soft and never interrupts a healthy turn.",
    ],
    parameters: spawnSchema,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({
        content: [
          {
            type: "text",
            text: "Preparing a Pi session launch in an external terminal window…",
          },
        ],
        details: { phase: "preparing" },
      });
      const result = await controller.spawn(ctx, params, signal);
      return {
        content: [
          {
            type: "text",
            text: `Pi session ${safeTerminalLine(result.name ?? result.sessionId)} is ready in an external window (${safeTerminalLine(result.cwd)}).${result.kickoffAccepted ? " Its first task was accepted." : " No first task was sent."}`,
          },
        ],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "session_bus",
    label: "Pi Session Bus",
    description:
      "List authenticated Pi Agent Swarm sessions, send a notify or one-turn request, or correlate a non-triggering reply. Delivery acknowledgement means accepted by the extension, not task completion.",
    promptSnippet: "List or message Pi Agent Swarm sessions on this machine",
    promptGuidelines: [
      "Use session_bus to communicate with sessions already connected through Pi Agent Swarm.",
      "Treat session_bus accepted acknowledgements as extension delivery only, not proof that a remote task succeeded.",
      "Workers with contextRecycling must report taskStatus=completed when done; unfinished workers publish a structured handoff when asked.",
    ],
    parameters: busSchema,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (params.action === "list") {
        assertAbsent(params.targetSessionId, "targetSessionId", "list");
        assertAbsent(params.message, "message", "list");
        assertAbsent(params.mode, "mode", "list");
        assertAbsent(params.replyTo, "replyTo", "list");
        assertAbsent(params.taskStatus, "taskStatus", "list");
        assertAbsent(params.handoff, "handoff", "list");
        const snapshot = await controller.snapshot(signal);
        if (!snapshot.connected) {
          return {
            content: [{ type: "text", text: "Pi Agent Swarm is not connected to a local group." }],
            details: { connected: false, peers: [] },
          };
        }
        return peerListResult(snapshot);
      }

      if (params.action === "shutdown") {
        assertAbsent(params.message, "message", "shutdown");
        assertAbsent(params.mode, "mode", "shutdown");
        assertAbsent(params.replyTo, "replyTo", "shutdown");
        assertAbsent(params.taskStatus, "taskStatus", "shutdown");
        assertAbsent(params.handoff, "handoff", "shutdown");
        const shutdownTarget = required(params.targetSessionId, "targetSessionId");
        const result = await controller.shutdownPeer(ctx, shutdownTarget, signal);
        return shutdownResult(result, shutdownTarget);
      }

      if (params.action === "handoff") {
        assertAbsent(params.targetSessionId, "targetSessionId", "handoff");
        assertAbsent(params.message, "message", "handoff");
        assertAbsent(params.mode, "mode", "handoff");
        assertAbsent(params.replyTo, "replyTo", "handoff");
        assertAbsent(params.taskStatus, "taskStatus", "handoff");
        if (!params.handoff) throw new Error("session_bus handoff is required for this action");
        const result = await controller.publishHandoff(ctx, params.handoff, signal);
        return {
          content: [{ type: "text", text: `Worker handoff is ready: ${safeTerminalLine(result.handoffPath)}` }],
          details: result,
        };
      }

      const targetSessionId = required(params.targetSessionId, "targetSessionId");
      const message = required(params.message, "message");
      if (params.action === "send") {
        assertAbsent(params.replyTo, "replyTo", "send");
        assertAbsent(params.taskStatus, "taskStatus", "send");
        assertAbsent(params.handoff, "handoff", "send");
        const mode = params.mode ?? "notify";
        const result = await controller.send(ctx, { targetSessionId, text: message, mode }, signal);
        return deliveryResult(result, targetSessionId);
      }
      assertAbsent(params.mode, "mode", "reply");
      const replyTo = required(params.replyTo, "replyTo");
      const result = await controller.send(
        ctx,
        {
          targetSessionId,
          text: message,
          mode: "reply",
          replyTo,
          ...(params.taskStatus ? { taskStatus: params.taskStatus } : {}),
          ...(params.handoff ? { handoff: params.handoff } : {}),
        },
        signal,
      );
      return deliveryResult(result, targetSessionId);
    },
  });
}

function peerListResult(snapshot: SwarmSnapshot) {
  const peers: SwarmSnapshot["peers"] = [];
  const lines: string[] = [];
  for (const peer of snapshot.peers.slice(0, MAX_LISTED_PEERS)) {
    const listedPeer = {
      ...peer,
      ...(peer.name ? { name: safeTerminalLine(peer.name) } : {}),
      cwd: safeTerminalLine(peer.cwd),
    };
    const colorLabel = listedPeer.color ? (swarmColorName(listedPeer.color) ?? listedPeer.color) : "no-color";
    const line = `${listedPeer.name ?? listedPeer.sessionId} · ${listedPeer.sessionId} · ${colorLabel} · ${listedPeer.cwd} · requests ${listedPeer.acceptsRequests ? "allowed" : "blocked"}`;
    const candidate = createPeerListResult(snapshot, [...peers, listedPeer], [...lines, line]);
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > MAX_LIST_RESULT_BYTES) break;
    peers.push(listedPeer);
    lines.push(line);
  }
  return createPeerListResult(snapshot, peers, lines);
}

function createPeerListResult(snapshot: SwarmSnapshot, peers: SwarmSnapshot["peers"], lines: string[]) {
  const peerText = lines.length
    ? lines.join("\n")
    : "Pi Agent Swarm is connected, but no other live sessions were found.";
  const text = snapshot.discoveryIssues?.length
    ? `${peerText}\nDiscovery reported ${snapshot.discoveryIssues.length} bounded transport issue(s); inspect tool details before retrying.`
    : peerText;
  return {
    content: [{ type: "text" as const, text }],
    details: {
      connected: true,
      peers,
      truncated: snapshot.peers.length > peers.length,
      ...(snapshot.discoveryIssues ? { discoveryIssues: snapshot.discoveryIssues } : {}),
      ...(snapshot.discoverySaturated ? { discoverySaturated: true } : {}),
    },
  };
}

function deliveryResult(result: { message: SwarmMessage; acknowledgement: SwarmDeliveryAck }, targetSessionId: string) {
  if (!result.acknowledgement.accepted) {
    const code = result.acknowledgement.code ? ` [${result.acknowledgement.code}]` : "";
    const retry = result.acknowledgement.retryAfterMs
      ? ` Retry after about ${result.acknowledgement.retryAfterMs}ms.`
      : "";
    throw new Error(
      `Pi Agent Swarm session ${safeTerminalLine(targetSessionId)} rejected the message${code}: ${safeTerminalLine(result.acknowledgement.error ?? "unknown reason")}.${retry}`,
    );
  }
  return {
    content: [
      {
        type: "text" as const,
        text: `Pi Agent Swarm session ${safeTerminalLine(targetSessionId)} accepted message ${safeTerminalLine(result.message.id)}${result.acknowledgement.duplicate ? " as an already-seen duplicate" : ""}. This does not prove remote task completion.`,
      },
    ],
    details: {
      messageId: result.message.id,
      targetSessionId,
      accepted: true,
      duplicate: result.acknowledgement.duplicate,
    },
  };
}

function shutdownResult(result: { message: SwarmMessage; acknowledgement: SwarmDeliveryAck }, targetSessionId: string) {
  if (!result.acknowledgement.accepted) {
    const code = result.acknowledgement.code ? ` [${result.acknowledgement.code}]` : "";
    const retry = result.acknowledgement.retryAfterMs
      ? ` Retry after about ${result.acknowledgement.retryAfterMs}ms.`
      : "";
    throw new Error(
      `Pi Agent Swarm session ${safeTerminalLine(targetSessionId)} rejected the shutdown request${code}: ${safeTerminalLine(result.acknowledgement.error ?? "unknown reason")}.${retry}`,
    );
  }
  return {
    content: [
      {
        type: "text" as const,
        text: `Pi Agent Swarm session ${safeTerminalLine(targetSessionId)} accepted the shutdown request (message ${safeTerminalLine(result.message.id)}). The peer was asked to shut down gracefully; this does not guarantee it has exited yet.`,
      },
    ],
    details: {
      messageId: result.message.id,
      targetSessionId,
      accepted: true,
      duplicate: result.acknowledgement.duplicate,
    },
  };
}

function required(value: string | undefined, field: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`session_bus ${field} is required for this action`);
  }
  return value;
}

function assertAbsent(value: unknown, field: string, action: string): void {
  if (value !== undefined) throw new Error(`session_bus ${field} is not accepted for action ${action}`);
}
