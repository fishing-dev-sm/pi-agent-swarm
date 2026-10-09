import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import { createGroup, formatInvite, type SwarmMessage, type SwarmPeerDescription } from "../src/protocol.js";
import { createInMemorySwarmSettingsRuntime } from "../src/settings.js";
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

test("setColorPalette persists the palette and remaps this session's hue slot", async () => {
  const mock = createMockPi();
  const deps = dependencies();
  const settings = createInMemorySwarmSettingsRuntime();
  const controller = new SwarmController(mock.pi, deps, settings);
  const context = createMockContext({ mode: "tui", hasUI: true });
  await controller.sessionStart({ reason: "startup" }, context.ctx);
  await controller.startNewGroup(context.ctx, false);
  await controller.setOwnColor(context.ctx, "#c22d40");
  assert.equal(deps.transports[0]?.options.peer.color, "#c22d40");

  await controller.setColorPalette(context.ctx, "bright");
  assert.equal(settings.get().settings.colorPalette, "bright");
  // Muted red maps onto bright red: the session keeps its hue slot.
  assert.equal(deps.transports[0]?.options.peer.color, "#db5855");

  // A custom hex outside both palettes is left untouched by palette switches.
  await controller.setOwnColor(context.ctx, "#123456");
  await controller.setColorPalette(context.ctx, "muted");
  assert.equal(settings.get().settings.colorPalette, "muted");
  assert.equal(deps.transports[0]?.options.peer.color, "#123456");
  await controller.sessionShutdown({ reason: "quit" }, context.ctx);
});

test("human session is auto-named from the first turns after the third turn", async () => {
  const mock = createMockPi();
  const completions: Array<{ model: unknown; prompt: string }> = [];
  const currentModel = { provider: "test-provider", id: "test-model" };
  const deps = dependencies({
    completeSessionTitle: async (_ctx, model, prompt) => {
      completions.push({ model, prompt });
      return "修复登录页样式";
    },
  });
  const controller = new SwarmController(mock.pi, deps);
  const context = createMockContext({
    mode: "tui",
    hasUI: true,
    model: currentModel,
    sessionManager: {
      getSessionId: () => "0a1b2c3d-rest",
      getSessionName: () => undefined,
      getEntries: () => [],
      getBranch: () => [
        { type: "message", message: { role: "user", content: "帮我修复登录页的样式问题", timestamp: 1 } },
        { type: "message", message: { role: "user", content: "按钮还是歪的", timestamp: 2 } },
      ],
    },
  });
  await controller.sessionStart({ reason: "startup" }, context.ctx);
  assert.equal(mock.sessionName, "MANAGER-0a1b2c3d");

  await controller.noteTurnEnd(context.ctx);
  await controller.noteTurnEnd(context.ctx);
  assert.equal(completions.length, 0);
  await controller.noteTurnEnd(context.ctx);
  assert.equal(completions.length, 1);
  assert.equal(completions[0]?.model, currentModel);
  assert.match(completions[0]?.prompt ?? "", /帮我修复登录页的样式问题/u);
  assert.equal(mock.sessionName, "MAN-修复登录页样式");
  assert.match(context.statuses.get("swarm-roster") ?? "", /MAN-修复登录页样式/u);

  // After the rename the default name is gone, so later turns never complete again.
  await controller.noteTurnEnd(context.ctx);
  assert.equal(completions.length, 1);
  await controller.sessionShutdown({ reason: "quit" }, context.ctx);
});

test("auto-naming skips spawned children, disabled settings, and user-named sessions", async () => {
  // A spawned child (launch envelope) is never eligible.
  const childMock = createMockPi();
  let childCompletions = 0;
  const childDeps = dependencies({
    environment: {
      PI_SWARM_INVITE: formatInvite(createGroup(Buffer.alloc(32, 9)).secret),
      PI_SWARM_PARENT_SESSION_ID: "parent",
      PI_SWARM_LAUNCH_ID: "launch_1234567890",
      PI_SWARM_KICKOFF_CAPABILITY: "kickoff_1234567890abcdef",
    },
    completeSessionTitle: async () => {
      childCompletions += 1;
      return "不应出现";
    },
  });
  const child = new SwarmController(childMock.pi, childDeps);
  const childContext = createMockContext({ mode: "tui", hasUI: true, model: { provider: "p", id: "m" } });
  await child.sessionStart({ reason: "startup" }, childContext.ctx);
  for (let turn = 0; turn < 4; turn++) await child.noteTurnEnd(childContext.ctx);
  assert.equal(childCompletions, 0);
  await child.sessionShutdown({ reason: "quit" }, childContext.ctx);

  // autoName=false blocks the completion entirely.
  const disabledMock = createMockPi();
  let disabledCompletions = 0;
  const disabledSettings = createInMemorySwarmSettingsRuntime();
  await disabledSettings.update({ autoName: false });
  const disabled = new SwarmController(
    disabledMock.pi,
    dependencies({
      completeSessionTitle: async () => {
        disabledCompletions += 1;
        return "不应出现";
      },
    }),
    disabledSettings,
  );
  const disabledContext = createMockContext({ mode: "tui", hasUI: true, model: { provider: "p", id: "m" } });
  await disabled.sessionStart({ reason: "startup" }, disabledContext.ctx);
  for (let turn = 0; turn < 3; turn++) await disabled.noteTurnEnd(disabledContext.ctx);
  assert.equal(disabledCompletions, 0);
  await disabled.sessionShutdown({ reason: "quit" }, disabledContext.ctx);

  // A name set outside the extension before the threshold turns auto-naming off.
  const renamedMock = createMockPi();
  let renamedCompletions = 0;
  const renamed = new SwarmController(
    renamedMock.pi,
    dependencies({
      completeSessionTitle: async () => {
        renamedCompletions += 1;
        return "不应出现";
      },
    }),
  );
  const renamedContext = createMockContext({ mode: "tui", hasUI: true, model: { provider: "p", id: "m" } });
  await renamed.sessionStart({ reason: "startup" }, renamedContext.ctx);
  await renamed.noteSessionInfoChanged("我的窗口", renamedContext.ctx);
  for (let turn = 0; turn < 3; turn++) await renamed.noteTurnEnd(renamedContext.ctx);
  assert.equal(renamedCompletions, 0);
  await renamed.sessionShutdown({ reason: "quit" }, renamedContext.ctx);
});

test("a user rename during the title completion wins over the auto-name", async () => {
  const mock = createMockPi();
  const deps = dependencies({
    completeSessionTitle: async () => {
      // The user renames the session while the completion is in flight.
      mock.rawPi.setSessionName("手动命名");
      return "自动标题";
    },
  });
  const controller = new SwarmController(mock.pi, deps);
  const context = createMockContext({
    mode: "tui",
    hasUI: true,
    model: { provider: "p", id: "m" },
    sessionManager: {
      getSessionId: () => "test-session",
      getSessionName: () => undefined,
      getEntries: () => [],
      getBranch: () => [{ type: "message", message: { role: "user", content: "帮我修登录页", timestamp: 1 } }],
    },
  });
  await controller.sessionStart({ reason: "startup" }, context.ctx);
  for (let turn = 0; turn < 3; turn++) await controller.noteTurnEnd(context.ctx);
  assert.equal(mock.sessionName, "手动命名");
  await controller.sessionShutdown({ reason: "quit" }, context.ctx);
});

test("auto-name failures stay silent, keep the default name, and are recorded", async () => {
  const mock = createMockPi();
  const deps = dependencies({
    completeSessionTitle: async () => {
      throw new Error("provider exploded");
    },
  });
  const controller = new SwarmController(mock.pi, deps);
  const context = createMockContext({
    mode: "tui",
    hasUI: true,
    model: { provider: "p", id: "m" },
    sessionManager: {
      getSessionId: () => "test-session",
      getSessionName: () => undefined,
      getEntries: () => [],
      getBranch: () => [{ type: "message", message: { role: "user", content: "调试构建", timestamp: 1 } }],
    },
  });
  await controller.sessionStart({ reason: "startup" }, context.ctx);
  for (let turn = 0; turn < 3; turn++) await controller.noteTurnEnd(context.ctx);
  assert.equal(mock.sessionName, "MANAGER-test-ses");
  assert.deepEqual(context.notifications, []);
  const failure = mock.entries.find((entry) => entry.customType === "pi-swarm-auto-name");
  assert.match(String((failure?.data as { error?: string } | undefined)?.error ?? ""), /provider exploded/u);
  await controller.sessionShutdown({ reason: "quit" }, context.ctx);
});

test("a failed auto-name attempt is retried on a later turn", async () => {
  const mock = createMockPi();
  let completions = 0;
  const deps = dependencies({
    completeSessionTitle: async () => {
      completions += 1;
      if (completions === 1) throw new Error("provider exploded");
      return "重试后的标题";
    },
  });
  const controller = new SwarmController(mock.pi, deps);
  const context = createMockContext({
    mode: "tui",
    hasUI: true,
    model: { provider: "p", id: "m" },
    sessionManager: {
      getSessionId: () => "test-session",
      getSessionName: () => undefined,
      getEntries: () => [],
      getBranch: () => [{ type: "message", message: { role: "user", content: "调试构建", timestamp: 1 } }],
    },
  });
  await controller.sessionStart({ reason: "startup" }, context.ctx);
  for (let turn = 0; turn < 3; turn++) await controller.noteTurnEnd(context.ctx);
  assert.equal(completions, 1);
  assert.equal(mock.sessionName, "MANAGER-test-ses");
  await controller.noteTurnEnd(context.ctx);
  assert.equal(completions, 2);
  assert.equal(mock.sessionName, "MAN-重试后的标题");
  // After a successful naming the session no longer carries the default name.
  await controller.noteTurnEnd(context.ctx);
  assert.equal(completions, 2);
  await controller.sessionShutdown({ reason: "quit" }, context.ctx);
});

test("an unresolvable autoNameModel warns once and keeps the default name", async () => {
  const mock = createMockPi();
  let completions = 0;
  const settings = createInMemorySwarmSettingsRuntime();
  await settings.update({ autoNameModel: "missing/model" });
  const deps = dependencies({
    completeSessionTitle: async () => {
      completions += 1;
      return "不应出现";
    },
  });
  const controller = new SwarmController(mock.pi, deps, settings);
  const context = createMockContext({
    mode: "tui",
    hasUI: true,
    model: { provider: "p", id: "m" },
    modelRegistry: { find: () => undefined },
  });
  await controller.sessionStart({ reason: "startup" }, context.ctx);
  for (let turn = 0; turn < 3; turn++) await controller.noteTurnEnd(context.ctx);
  assert.equal(completions, 0);
  assert.equal(mock.sessionName, "MANAGER-test-ses");
  assert.ok(context.notifications.some((n) => n.level === "warning" && n.message.includes("autoNameModel")));
  await controller.sessionShutdown({ reason: "quit" }, context.ctx);
});

test("a name change outside the extension refreshes the transport name and footer badge", async () => {
  const mock = createMockPi();
  const deps = dependencies();
  const controller = new SwarmController(mock.pi, deps);
  const context = createMockContext({ mode: "tui", hasUI: true });
  await controller.sessionStart({ reason: "startup" }, context.ctx);
  await controller.startNewGroup(context.ctx, false);
  assert.match(context.statuses.get("swarm-roster") ?? "", /MANAGER-test-ses/u);

  // Pi's /name updates the session metadata and fires session_info_changed.
  mock.rawPi.setSessionName("支付网关联调");
  await controller.noteSessionInfoChanged("支付网关联调", context.ctx);
  assert.equal(deps.transports[0]?.options.peer.name, "支付网关联调");
  assert.match(context.statuses.get("swarm-roster") ?? "", /支付网关联调/u);
  await controller.sessionShutdown({ reason: "quit" }, context.ctx);
});
