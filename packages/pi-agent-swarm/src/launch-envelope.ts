type SwarmThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const SWARM_LAUNCH_ENV_KEYS = [
  "PI_SWARM_INVITE",
  "PI_SWARM_PARENT_SESSION_ID",
  "PI_SWARM_LAUNCH_ID",
  "PI_SWARM_KICKOFF_CAPABILITY",
  "PI_SWARM_CHILD_NAME",
  "PI_SWARM_COLOR",
  "PI_SWARM_ACCEPT_REQUESTS",
  "PI_SWARM_MODEL_PROVIDER",
  "PI_SWARM_MODEL_ID",
  "PI_SWARM_THINKING",
] as const;

export interface SwarmLaunchEnvelope {
  invite: string;
  parentSessionId: string;
  launchId: string;
  kickoffCapability: string;
  childName?: string;
  childColor?: string;
  acceptsRequests: boolean;
  model?: { provider: string; id: string; thinkingLevel?: SwarmThinkingLevel };
}

const THINKING_LEVELS = new Set<SwarmThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/u;

export function consumeLaunchEnvelope(environment: NodeJS.ProcessEnv = process.env): SwarmLaunchEnvelope | undefined {
  const values = Object.fromEntries(SWARM_LAUNCH_ENV_KEYS.map((key) => [key, environment[key]]));
  for (const key of SWARM_LAUNCH_ENV_KEYS) delete environment[key];
  if (values.PI_SWARM_INVITE === undefined) {
    if (Object.values(values).some((value) => value !== undefined)) {
      throw new Error("Pi Agent Swarm launch envelope is incomplete");
    }
    return undefined;
  }
  const invite = bounded(values.PI_SWARM_INVITE, "invite", 256);
  const parentSessionId = safeId(values.PI_SWARM_PARENT_SESSION_ID, "parent session id");
  const launchId = safeId(values.PI_SWARM_LAUNCH_ID, "launch id");
  const kickoffCapability = safeId(values.PI_SWARM_KICKOFF_CAPABILITY, "kickoff capability");
  const childName = optionalBounded(values.PI_SWARM_CHILD_NAME, "child name", 200);
  const childColor = optionalHexColor(values.PI_SWARM_COLOR);
  const acceptsRequests = parseBoolean(values.PI_SWARM_ACCEPT_REQUESTS);
  const provider = optionalBounded(values.PI_SWARM_MODEL_PROVIDER, "model provider", 200);
  const id = optionalBounded(values.PI_SWARM_MODEL_ID, "model id", 500);
  if ((provider === undefined) !== (id === undefined)) {
    throw new Error("Pi Agent Swarm launch model identity is incomplete");
  }
  const thinking = values.PI_SWARM_THINKING;
  if (thinking !== undefined && (!provider || !id)) {
    throw new Error("Pi Agent Swarm launch model identity is incomplete");
  }
  if (thinking !== undefined && !THINKING_LEVELS.has(thinking as SwarmThinkingLevel)) {
    throw new Error("Pi Agent Swarm launch thinking level is invalid");
  }
  return {
    invite,
    parentSessionId,
    launchId,
    kickoffCapability,
    ...(childName ? { childName } : {}),
    ...(childColor ? { childColor } : {}),
    acceptsRequests,
    ...(provider && id
      ? {
          model: {
            provider,
            id,
            ...(thinking ? { thinkingLevel: thinking as SwarmThinkingLevel } : {}),
          },
        }
      : {}),
  };
}

export function launchEnvelopeEnvironment(envelope: SwarmLaunchEnvelope): Record<string, string> {
  return {
    PI_SWARM_INVITE: envelope.invite,
    PI_SWARM_PARENT_SESSION_ID: envelope.parentSessionId,
    PI_SWARM_LAUNCH_ID: envelope.launchId,
    PI_SWARM_KICKOFF_CAPABILITY: envelope.kickoffCapability,
    PI_SWARM_ACCEPT_REQUESTS: envelope.acceptsRequests ? "1" : "0",
    ...(envelope.childName ? { PI_SWARM_CHILD_NAME: envelope.childName } : {}),
    ...(envelope.childColor ? { PI_SWARM_COLOR: envelope.childColor } : {}),
    ...(envelope.model
      ? {
          PI_SWARM_MODEL_PROVIDER: envelope.model.provider,
          PI_SWARM_MODEL_ID: envelope.model.id,
          ...(envelope.model.thinkingLevel ? { PI_SWARM_THINKING: envelope.model.thinkingLevel } : {}),
        }
      : {}),
  };
}

function parseBoolean(value: string | undefined): boolean {
  if (value === undefined || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Pi Agent Swarm launch request policy is invalid");
}

function safeId(value: string | undefined, label: string): string {
  if (!value || !SAFE_ID.test(value)) throw new Error(`Pi Agent Swarm launch ${label} is invalid`);
  return value;
}

function bounded(value: string | undefined, label: string, maxBytes: number): string {
  if (!value || value.includes("\0") || Buffer.byteLength(value) > maxBytes) {
    throw new Error(`Pi Agent Swarm launch ${label} is invalid`);
  }
  return value;
}

function optionalBounded(value: string | undefined, label: string, maxBytes: number): string | undefined {
  return value === undefined ? undefined : bounded(value, label, maxBytes);
}

function optionalHexColor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const lower = value.toLowerCase();
  if (!/^#[0-9a-f]{6}$/u.test(lower)) throw new Error("Pi Agent Swarm launch color is invalid");
  return lower;
}
