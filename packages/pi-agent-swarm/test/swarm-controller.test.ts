import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import { createGroup, formatInvite, type SwarmMessage, type SwarmPeerDescription } from "../src/protocol.js";
import { SwarmController, type SwarmControllerDependencies } from "../src/swarm-controller.js";
import type { SwarmDeliveryAck, SwarmTransportOptions } from "../src/transport.js";

class FakeTransport {
  started = false;
  stopped = 0;
  messages: SwarmMessage[] = [];
  peers: SwarmPeerDescription[] = [];
  startHook?: () => Promise<void>;
  listPeersHook?: () => Promise<SwarmPeerDescription[]>;
  get endpointManifest() {
    return {
      directory: this.directory,
      endpointId: "endpoint1234",
      socketPath: join(this.directory, "endpoint1234.sock"),
      manifestPath: join(this.directory, "endpoint1234.json"),
      peer: this.options.peer,
    };
  }

  constructor(
    readonly options: SwarmTransportOptions,
    private readonly directory = "/tmp/pi-swarm-test",
  ) {}
  async start() {
    await this.startHook?.();
    this.started = true;
  }
  async stop() {
    this.stopped += 1;
  }
  async listPeers() {
    return this.listPeersHook ? this.listPeersHook() : [...this.peers];
  }
  async send(_target: string, message: SwarmMessage): Promise<SwarmDeliveryAck> {
    this.messages.push(message);
    return { accepted: true, duplicate: false };
  }
  setAcceptsRequests(value: boolean) {
    this.options.peer.acceptsRequests = value;
  }
  setColor(color: string) {
    this.options.peer.color = color;
  }
  setName(name: string) {
    this.options.peer.name = name;
  }
  get peerDescription() {
    return { ...this.options.peer, endpointId: "a".repeat(24) };
  }
}

function dependencies(
  overrides: Partial<SwarmControllerDependencies> = {},
): SwarmControllerDependencies & { transports: FakeTransport[] } {
  const transports: FakeTransport[] = [];
  return {
    transports,
    createTransport: (options) => {
      const transport = new FakeTransport(options);
      transports.push(transport);
      return transport;
    },
    createExternal: () => ({
      assertAvailable: async () => "alacritty",
      spawnSplit: async () => ({ terminalId: "external-child", version: "alacritty" }),
    }),
    resolveInvocation: () => ({ command: "/bin/pi", args: [] }),
    createLauncher: async () => ({
      path: "/tmp/pi-swarm-test/launch.sh",
      command: "/tmp/pi-swarm-test/launch.sh",
      cleanup: async () => undefined,
    }),
    realpath: async (value) => value,
    isDirectory: async () => true,
    now: () => 1_800_000_000_000,
    randomId: (prefix) => `${prefix}_1234567890abcdef`,
    sleep: async () => undefined,
    launchTimeoutMs: 100,
    environment: {},
    ...overrides,
  };
}

test("factory and ordinary session start create no resources or warning", async () => {
  const mock = createMockPi();
  const deps = dependencies();
  const controller = new SwarmController(mock.pi, deps);
  assert.equal(deps.transports.length, 0);
  const context = createMockContext({ mode: "tui", hasUI: true });
  await controller.sessionStart({ reason: "startup" }, context.ctx);
  assert.equal(deps.transports.length, 0);
  assert.deepEqual(context.notifications, []);
  await controller.sessionShutdown({ reason: "quit" }, context.ctx);
  assert.equal(context.statuses.get("swarm"), undefined);
});

test("child launch envelope is consumed, redacted, named, and joined quietly", async () => {
  const mock = createMockPi();
  const environment: NodeJS.ProcessEnv = {
    PI_SWARM_INVITE: formatInvite(createGroup(Buffer.alloc(32, 9)).secret),
    PI_SWARM_PARENT_SESSION_ID: "parent",
    PI_SWARM_LAUNCH_ID: "launch_1234567890",
    PI_SWARM_KICKOFF_CAPABILITY: "kickoff_1234567890abcdef",
    PI_SWARM_CHILD_NAME: "Child",
    PI_SWARM_ACCEPT_REQUESTS: "0",
    PI_SWARM_MODEL_PROVIDER: "provider",
    PI_SWARM_MODEL_ID: "model",
    PI_SWARM_THINKING: "high",
  };
  const deps = dependencies({ environment });
  const controller = new SwarmController(mock.pi, deps);
  const inheritedModel = { provider: "provider", id: "model" };
  const context = createMockContext({
    mode: "tui",
    hasUI: true,
    modelRegistry: { find: () => inheritedModel },
    sessionManager: {
      getSessionId: () => "test-session",
      getSessionName: () => undefined,
      getEntries: () => [],
      getBranch: () => [
        {
          type: "custom_message",
          customType: "pi-agent-swarm-message",
          details: {
            message: {
              id: "msg_previous_1234",
              mode: "kickoff",
              launchId: "launch_1234567890",
            },
          },
        },
      ],
    },
  });
  await controller.sessionStart({ reason: "startup" }, context.ctx);
  assert.equal(Object.keys(environment).length, 0);
  assert.equal(deps.transports.length, 1);
  assert.equal(deps.transports[0]?.started, true);
  assert.deepEqual(deps.transports[0]?.options.seenMessageIds, ["msg_previous_1234"]);
  assert.equal(deps.transports[0]?.options.kickoffCapability, "kickoff_1234567890abcdef");
  assert.equal(deps.transports[0]?.options.kickoffConsumed, true);
  assert.deepEqual(context.notifications, []);
  assert.equal(mock.sessionName, "Child");
  assert.deepEqual(mock.setModels, [inheritedModel]);
  assert.deepEqual(mock.thinkingLevels, ["high"]);
  assert.equal(JSON.stringify(context.notifications).includes("piagentswarm:v1"), false);
  await controller.sessionShutdown({ reason: "quit" }, context.ctx);
  await controller.sessionShutdown({ reason: "quit" }, context.ctx);
  assert.equal(deps.transports[0]?.stopped, 1);
  await assert.rejects(controller.snapshot(), /stale/u);
});

test("reload hands membership only to the same session manager", async () => {
  const mock = createMockPi();
  const firstDeps = dependencies();
  const first = new SwarmController(mock.pi, firstDeps);
  const sessionManager = {
    getSessionId: () => "same-session",
    getSessionName: () => undefined,
    getBranch: () => [],
    getEntries: () => [],
  };
  const context = createMockContext({ mode: "tui", hasUI: true, sessionManager });
  await first.sessionStart({ reason: "startup" }, context.ctx);
  await first.startNewGroup(context.ctx, false);
  const groupId = firstDeps.transports[0]?.options.group.id;
  await first.sessionShutdown({ reason: "reload" }, context.ctx);

  const secondDeps = dependencies();
  const second = new SwarmController(mock.pi, secondDeps);
  await second.sessionStart({ reason: "reload" }, context.ctx);
  assert.equal(secondDeps.transports[0]?.options.group.id, groupId);
  assert.equal(context.notifications.length, 0);

  const otherDeps = dependencies();
  const other = new SwarmController(mock.pi, otherDeps);
  const otherContext = createMockContext({
    mode: "tui",
    hasUI: true,
    sessionManager: { ...sessionManager, getSessionId: () => "other-session" },
  });
  await other.sessionStart({ reason: "new" }, otherContext.ctx);
  assert.equal(otherDeps.transports.length, 0);
  await second.sessionShutdown({ reason: "quit" }, context.ctx);
  await other.sessionShutdown({ reason: "quit" }, otherContext.ctx);
});

test("partial group startup stops its transport and leaves disconnected state", async () => {
  const mock = createMockPi();
  let transport: FakeTransport | undefined;
  const deps = dependencies({
    createTransport: (options) => {
      transport = new FakeTransport(options);
      transport.startHook = async () => {
        throw new Error("partial startup failed");
      };
      return transport;
    },
  });
  const controller = new SwarmController(mock.pi, deps);
  const context = createMockContext({ mode: "tui", hasUI: true });
  await controller.sessionStart({ reason: "startup" }, context.ctx);
  await assert.rejects(controller.startNewGroup(context.ctx, false), /partial startup/u);
  assert.equal(transport?.stopped, 1);
  assert.deepEqual(await controller.snapshot(), {
    connected: false,
    acceptsRequests: false,
    peers: [],
  });
  assert.equal(context.statuses.get("swarm"), undefined);
  await controller.sessionShutdown({ reason: "quit" }, context.ctx);
});

test("concurrent group starts publish one transport without leaking the loser", async () => {
  const mock = createMockPi();
  const transports: FakeTransport[] = [];
  let releaseStart!: () => void;
  let signalStartEntered!: () => void;
  const startEntered = new Promise<void>((resolve) => {
    signalStartEntered = resolve;
  });
  const startReleased = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  const deps = dependencies({
    createTransport: (options) => {
      const transport = new FakeTransport(options);
      transport.startHook = async () => {
        signalStartEntered();
        await startReleased;
      };
      transports.push(transport);
      return transport;
    },
  });
  const controller = new SwarmController(mock.pi, deps);
  const context = createMockContext({ mode: "tui", hasUI: true });
  await controller.sessionStart({ reason: "startup" }, context.ctx);
  const first = controller.startNewGroup(context.ctx, false);
  await startEntered;
  const second = controller.startNewGroup(context.ctx, false);
  assert.equal(transports.length, 1);
  releaseStart();
  const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);
  assert.equal(transports.length, 1);
  assert.equal(secondSnapshot.groupId, firstSnapshot.groupId);
  await controller.sessionShutdown({ reason: "quit" }, context.ctx);
  assert.equal(transports[0]?.stopped, 1);
});

test("snapshot rejects a result that completes after session shutdown", async () => {
  const mock = createMockPi();
  const deps = dependencies();
  const controller = new SwarmController(mock.pi, deps);
  const context = createMockContext({ mode: "tui", hasUI: true });
  await controller.sessionStart({ reason: "startup" }, context.ctx);
  await controller.startNewGroup(context.ctx, false);
  let resolveList!: (peers: SwarmPeerDescription[]) => void;
  const transport = deps.transports[0];
  assert.ok(transport);
  transport.listPeersHook = () =>
    new Promise((resolve) => {
      resolveList = resolve;
    });
  const snapshot = controller.snapshot();
  await controller.sessionShutdown({ reason: "quit" }, context.ctx);
  resolveList([]);
  await assert.rejects(snapshot, /stale/u);
});

test("incoming messages use follow-up delivery and replies wake the peer", async () => {
  const mock = createMockPi();
  const deps = dependencies();
  const controller = new SwarmController(mock.pi, deps);
  const context = createMockContext({ mode: "tui", hasUI: true });
  await controller.sessionStart({ reason: "startup" }, context.ctx);
  await controller.startNewGroup(context.ctx, true);
  const receive = deps.transports[0]?.options.onMessage;
  assert.ok(receive);
  const issuedAt = Date.now();
  const expiry = { issuedAt, expiresAt: issuedAt + 120_000 };
  const deliverySignal = new AbortController().signal;
  await receive(
    {
      id: "msg_notify_123456",
      fromSessionId: "peer",
      fromName: "Peer",
      fromCwd: "/tmp/peer",
      toSessionId: "test-session",
      mode: "notify",
      text: "hello",
      ...expiry,
    },
    deliverySignal,
  );
  await receive(
    {
      id: "msg_request_12345",
      fromSessionId: "peer",
      toSessionId: "test-session",
      mode: "request",
      text: "check tests",
      ...expiry,
    },
    deliverySignal,
  );
  await receive(
    {
      id: "msg_reply_1234567",
      fromSessionId: "peer",
      toSessionId: "test-session",
      mode: "reply",
      text: "done",
      replyTo: "msg_request_12345",
      ...expiry,
    },
    deliverySignal,
  );
  await receive(
    {
      id: "msg_kickoff_12345",
      fromSessionId: "peer",
      toSessionId: "test-session",
      mode: "kickoff",
      text: "begin",
      launchId: "launch_12345678",
      ...expiry,
    },
    deliverySignal,
  );
  assert.deepEqual(
    mock.sentMessages.map(({ options }) => options),
    [
      { deliverAs: "followUp", triggerTurn: false },
      { deliverAs: "followUp", triggerTurn: true },
      { deliverAs: "followUp", triggerTurn: true },
      { deliverAs: "followUp", triggerTurn: true },
    ],
  );
  assert.equal(JSON.stringify(mock.sentMessages).includes("/tmp/peer"), true);
  await controller.sessionShutdown({ reason: "quit" }, context.ctx);
});

type LeadTestContext = ReturnType<typeof createMockContext>;

async function leadTestSetup(directory: string, sessionId: string) {
  const mock = createMockPi();
  const transports: FakeTransport[] = [];
  const deps = dependencies({
    createTransport: (options) => {
      const transport = new FakeTransport(options, directory);
      transports.push(transport);
      return transport;
    },
  });
  const sessionManager = {
    getSessionId: () => sessionId,
    getSessionName: () => undefined,
    getBranch: () => [],
    getEntries: () => [],
  };
  const context = createMockContext({ mode: "tui", hasUI: true, sessionManager });
  return { mock, transports, deps, sessionManager, context };
}

async function waitForRosterStatus(context: LeadTestContext): Promise<string | undefined> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = context.statuses.get("swarm-roster");
    if (value !== undefined) return value;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return context.statuses.get("swarm-roster");
}

async function readLeadRecord(directory: string): Promise<{ sessionId?: string } | undefined> {
  try {
    return JSON.parse(await readFile(join(directory, "lead.json"), "utf8")) as { sessionId?: string };
  } catch {
    return undefined;
  }
}

test("lead record survives reload and the rejoined session restores the leader role", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-swarm-lead-"));
  t.onTestFinished(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const first = await leadTestSetup(directory, "same-session");
  const controller = new SwarmController(first.mock.pi, first.deps);
  await controller.sessionStart({ reason: "startup" }, first.context.ctx);
  await controller.startNewGroup(first.context.ctx, false);
  assert.equal((await readLeadRecord(directory))?.sessionId, "same-session");

  await controller.sessionShutdown({ reason: "reload" }, first.context.ctx);
  // A reload comes right back through the reload handoff, so the lead record must
  // survive; deleting it would demote the whole group (and the lead itself) to WORKER.
  assert.equal((await readLeadRecord(directory))?.sessionId, "same-session");

  const reloaded = await leadTestSetup(directory, "same-session");
  const second = new SwarmController(reloaded.mock.pi, reloaded.deps);
  await second.sessionStart({ reason: "reload" }, first.context.ctx);
  assert.equal(reloaded.transports[0]?.options.group.id, first.transports[0]?.options.group.id);
  const roster = await waitForRosterStatus(first.context);
  assert.equal(roster?.includes("LEADER"), true);
  await second.sessionShutdown({ reason: "quit" }, first.context.ctx);
});

test("lead record is removed when the lead quits or leaves", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-swarm-lead-"));
  t.onTestFinished(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const quitter = await leadTestSetup(directory, "quitting-lead");
  const first = new SwarmController(quitter.mock.pi, quitter.deps);
  await first.sessionStart({ reason: "startup" }, quitter.context.ctx);
  await first.startNewGroup(quitter.context.ctx, false);
  assert.equal((await readLeadRecord(directory))?.sessionId, "quitting-lead");
  await first.sessionShutdown({ reason: "quit" }, quitter.context.ctx);
  assert.equal(await readLeadRecord(directory), undefined);

  const leaver = await leadTestSetup(directory, "leaving-lead");
  const second = new SwarmController(leaver.mock.pi, leaver.deps);
  await second.sessionStart({ reason: "startup" }, leaver.context.ctx);
  await second.startNewGroup(leaver.context.ctx, false);
  assert.equal((await readLeadRecord(directory))?.sessionId, "leaving-lead");
  await second.leave(leaver.context.ctx);
  assert.equal(await readLeadRecord(directory), undefined);
  await second.sessionShutdown({ reason: "quit" }, leaver.context.ctx);
});

test("session replacement removes the replaced session's lead record", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-swarm-lead-"));
  t.onTestFinished(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const replaced = await leadTestSetup(directory, "replaced-session");
  const controller = new SwarmController(replaced.mock.pi, replaced.deps);
  await controller.sessionStart({ reason: "startup" }, replaced.context.ctx);
  await controller.startNewGroup(replaced.context.ctx, false);
  assert.equal((await readLeadRecord(directory))?.sessionId, "replaced-session");

  const replacementContext = createMockContext({
    mode: "tui",
    hasUI: true,
    sessionManager: {
      getSessionId: () => "replacement-session",
      getSessionName: () => undefined,
      getBranch: () => [],
      getEntries: () => [],
    },
  });
  await controller.sessionStart({ reason: "startup" }, replacementContext.ctx);
  assert.equal(await readLeadRecord(directory), undefined);
  await controller.sessionShutdown({ reason: "quit" }, replacementContext.ctx);
});

test("member reload preserves another session's lead record", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-swarm-lead-"));
  t.onTestFinished(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const member = await leadTestSetup(directory, "member-session");
  const controller = new SwarmController(member.mock.pi, member.deps);
  await controller.sessionStart({ reason: "startup" }, member.context.ctx);
  await controller.startNewGroup(member.context.ctx, false);
  await controller.setLead(member.context.ctx, {
    protocolVersion: 1,
    sessionId: "other-lead",
    endpointId: "b".repeat(24),
    cwd: directory,
    pid: 0,
    acceptsRequests: false,
  });
  assert.equal((await readLeadRecord(directory))?.sessionId, "other-lead");

  await controller.sessionShutdown({ reason: "reload" }, member.context.ctx);
  assert.equal((await readLeadRecord(directory))?.sessionId, "other-lead");

  const reloaded = await leadTestSetup(directory, "member-session");
  const second = new SwarmController(reloaded.mock.pi, reloaded.deps);
  await second.sessionStart({ reason: "reload" }, member.context.ctx);
  const roster = await waitForRosterStatus(member.context);
  assert.equal(roster?.includes("WORKER"), true);
  assert.equal((await readLeadRecord(directory))?.sessionId, "other-lead");
  await second.sessionShutdown({ reason: "quit" }, member.context.ctx);
});

test("reload without a lead record stays worker without recreating one", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-swarm-lead-"));
  t.onTestFinished(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const first = await leadTestSetup(directory, "same-session");
  const controller = new SwarmController(first.mock.pi, first.deps);
  await controller.sessionStart({ reason: "startup" }, first.context.ctx);
  await controller.startNewGroup(first.context.ctx, false);
  await rm(join(directory, "lead.json"), { force: true });

  await controller.sessionShutdown({ reason: "reload" }, first.context.ctx);
  assert.equal(await readLeadRecord(directory), undefined);

  const reloaded = await leadTestSetup(directory, "same-session");
  const second = new SwarmController(reloaded.mock.pi, reloaded.deps);
  await second.sessionStart({ reason: "reload" }, first.context.ctx);
  const roster = await waitForRosterStatus(first.context);
  assert.equal(roster?.includes("WORKER"), true);
  assert.equal(await readLeadRecord(directory), undefined);
  await second.sessionShutdown({ reason: "quit" }, first.context.ctx);
});
