import assert from "node:assert/strict";
import { test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import { ExternalLaunchError } from "../src/external.js";
import type { SwarmMessage, SwarmPeerDescription } from "../src/protocol.js";
import {
  DEFAULT_SWARM_SETTINGS,
  type SwarmSettings,
  type SwarmSettingsPatch,
  type SwarmSettingsRuntime,
  type SwarmSettingsState,
} from "../src/settings.js";
import {
  SwarmController,
  type SwarmControllerDependencies,
  type SwarmTerminalPort,
  type SwarmTransportPort,
} from "../src/swarm-controller.js";
import type { SwarmDeliveryAck, SwarmSendAuthorization, SwarmTransportOptions } from "../src/transport.js";

class SpawnTransport implements SwarmTransportPort {
  peers: SwarmPeerDescription[] = [];
  messages: SwarmMessage[] = [];
  authorizations: Array<SwarmSendAuthorization | undefined> = [];
  stopped = 0;
  beforeList?: () => void;
  readonly endpointManifest = {
    directory: "/tmp/pi-swarm-spawn-test",
    socketPath: "/tmp/pi-swarm-spawn-test/endpoint.sock",
    manifestPath: "/tmp/pi-swarm-spawn-test/endpoint.json",
  };
  constructor(readonly options: SwarmTransportOptions) {}
  async start() {}
  async stop() {
    this.stopped += 1;
  }
  async listPeers() {
    this.beforeList?.();
    return [...this.peers];
  }
  async send(
    _targetSessionId: string,
    message: SwarmMessage,
    _signal?: AbortSignal,
    authorization?: SwarmSendAuthorization,
  ): Promise<SwarmDeliveryAck> {
    this.messages.push(message);
    this.authorizations.push(authorization);
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

function harness(options: { ready?: boolean; launchError?: Error } = {}) {
  const mock = createMockPi();
  const transports: SpawnTransport[] = [];
  const externalSplitCalls: Parameters<SwarmTerminalPort["spawnSplit"]>[0][] = [];
  let now = 1_800_000_000_000;
  let externalCreated = 0;
  let launcherCleaned = false;
  const launcherEnvironments: Array<Readonly<Record<string, string>> | undefined> = [];
  let cleanupStateAtFirstPoll: boolean | undefined;
  let pendingPeer: SwarmPeerDescription | undefined;
  const spawnSplit = async (spawnOptions: Parameters<SwarmTerminalPort["spawnSplit"]>[0]) => {
    externalSplitCalls.push(spawnOptions);
    if (options.launchError) throw options.launchError;
    if (options.ready !== false) {
      const childEnvironment =
        Object.keys(spawnOptions.environment).length > 0
          ? spawnOptions.environment
          : (launcherEnvironments.at(-1) ?? {});
      pendingPeer = {
        protocolVersion: 2,
        sessionId: "child-session",
        endpointId: "b".repeat(24),
        name: childEnvironment.PI_SWARM_CHILD_NAME,
        cwd: spawnOptions.cwd,
        pid: 456,
        launchId: childEnvironment.PI_SWARM_LAUNCH_ID,
        acceptsRequests: false,
      };
    }
    return { terminalId: "external-child", version: "alacritty" };
  };
  const deps: SwarmControllerDependencies = {
    createTransport: (transportOptions) => {
      const transport = new SpawnTransport(transportOptions);
      transport.beforeList = () => {
        if (externalSplitCalls.length > 0 && cleanupStateAtFirstPoll === undefined) {
          cleanupStateAtFirstPoll = launcherCleaned;
        }
        if (pendingPeer) {
          transport.peers.push(pendingPeer);
          pendingPeer = undefined;
        }
      };
      transports.push(transport);
      return transport;
    },
    createExternal: () => {
      externalCreated += 1;
      return {
        assertAvailable: async () => "alacritty",
        spawnSplit,
      };
    },
    resolveInvocation: (args) => ({ command: "/bin/pi", args }),
    createLauncher: async (_invocation, _directory, environment) => {
      launcherEnvironments.push(environment);
      return {
        path: "/tmp/pi-swarm-spawn-test/launch.sh",
        command: "/tmp/pi-swarm-spawn-test/launch.sh",
        cleanup: async () => {
          launcherCleaned = true;
        },
      };
    },
    realpath: async (value) => `/real${value}`,
    isDirectory: async () => true,
    now: () => now,
    randomId: (prefix) => `${prefix}_1234567890abcdef`,
    sleep: async () => {
      now += 101;
    },
    launchTimeoutMs: 200,
    environment: {},
  };
  return {
    mock,
    deps,
    transports,
    splitCalls: externalSplitCalls,
    launcherEnvironments,
    get externalCreated() {
      return externalCreated;
    },
    get launcherCleaned() {
      return launcherCleaned;
    },
    get cleanupStateAtFirstPoll() {
      return cleanupStateAtFirstPoll;
    },
  };
}

test("spawn auto-creates a group, preserves parent, inherits model, and sends kickoff", async () => {
  const runtime = harness();
  const { mock, deps, transports, splitCalls } = runtime;
  const controller = new SwarmController(mock.pi, deps);
  const confirmationMessages: string[] = [];
  const context = createMockContext({
    mode: "tui",
    hasUI: true,
    cwd: "/project",
    model: { provider: "provider", id: "model" },
    thinkingLevel: "high",
    confirm: async (_title: string, message: string) => {
      confirmationMessages.push(message);
      return true;
    },
  });
  await controller.sessionStart({ reason: "startup" }, context.ctx);
  const result = await controller.spawn(context.ctx, {
    direction: "down",
    name: "Child",
    task: "Check tests",
    cwd: "worktree",
  });
  assert.equal(confirmationMessages.length, 1);
  assert.equal(
    confirmationMessages.some((message) => /External terminal window/u.test(message)),
    true,
  );
  assert.equal(transports.length, 1);
  assert.equal(splitCalls.length, 1);
  assert.equal(runtime.externalCreated, 1);
  assert.equal(splitCalls[0]?.direction, "down");
  assert.equal(runtime.cleanupStateAtFirstPoll, false);
  assert.equal(splitCalls[0]?.cwd, "/real/project/worktree");
  assert.equal(runtime.launcherEnvironments[0]?.PI_SWARM_MODEL_PROVIDER, "provider");
  assert.equal(runtime.launcherEnvironments[0]?.PI_SWARM_MODEL_ID, "model");
  assert.equal(runtime.launcherEnvironments[0]?.PI_SWARM_THINKING, "high");
  assert.match(runtime.launcherEnvironments[0]?.PI_SWARM_INVITE ?? "", /^piagentswarm:v1:/u);
  assert.match(runtime.launcherEnvironments[0]?.PI_SWARM_KICKOFF_CAPABILITY ?? "", /^kickoff_/u);
  assert.equal(transports[0]?.messages[0]?.mode, "kickoff");
  assert.equal(
    transports[0]?.authorizations[0]?.kickoffCapability,
    runtime.launcherEnvironments[0]?.PI_SWARM_KICKOFF_CAPABILITY,
  );
  assert.equal(transports[0]?.messages[0]?.text, "Check tests");
  assert.equal(result.sessionId, "child-session");
  assert.equal(result.terminalId, "external-child");
  assert.equal(result.terminalVersion, "alacritty");
  assert.equal(result.kickoffAccepted, true);
  assert.equal(runtime.launcherCleaned, true);
  assert.equal(mock.sentMessages.length, 0);
  await controller.sessionShutdown({ reason: "quit" }, context.ctx);
});

test("spawn reuses an existing group and supports all split directions", async () => {
  for (const direction of ["right", "down", "left", "up"] as const) {
    const { mock, deps, transports, splitCalls } = harness();
    const controller = new SwarmController(mock.pi, deps);
    const context = createMockContext({ mode: "rpc", hasUI: true, confirm: async () => true });
    await controller.sessionStart({ reason: "startup" }, context.ctx);
    await controller.startNewGroup(context.ctx, false);
    await controller.spawn(context.ctx, { direction });
    assert.equal(transports.length, 1);
    assert.equal(splitCalls[0]?.direction, direction);
    await controller.sessionShutdown({ reason: "quit" }, context.ctx);
  }
});

test("disabled launch confirmation skips every confirmation", async () => {
  const runtime = harness();
  const settings = memorySettingsRuntime({ confirmSessionLaunch: false });
  const controller = new SwarmController(runtime.mock.pi, runtime.deps, settings);
  const confirmationTitles: string[] = [];
  const context = createMockContext({
    mode: "tui",
    hasUI: true,
    confirm: async (title: string) => {
      confirmationTitles.push(title);
      return true;
    },
  });
  await controller.sessionStart({ reason: "startup" }, context.ctx);
  await controller.spawn(context.ctx, {});
  assert.deepEqual(confirmationTitles, []);
  await controller.sessionShutdown({ reason: "quit" }, context.ctx);
});

test("settings reload on session start, report invalid data, and flush on shutdown", async () => {
  const runtime = harness();
  const settings = memorySettingsRuntime({}, "invalid settings");
  const controller = new SwarmController(runtime.mock.pi, runtime.deps, settings);
  const context = createMockContext({ mode: "tui", hasUI: true });
  await controller.sessionStart({ reason: "startup" }, context.ctx);
  assert.equal(settings.calls.reload, 1);
  assert.match(context.notifications.at(-1)?.message ?? "", /invalid settings/u);
  await controller.sessionShutdown({ reason: "quit" }, context.ctx);
  assert.equal(settings.calls.flush, 1);
});

test("a concurrent launch failure cannot roll back another launch's automatic group", async () => {
  const runtime = harness();
  let terminalIndex = 0;
  let availabilityCount = 0;
  let releaseAvailability!: () => void;
  const availabilityReleased = new Promise<void>((resolve) => {
    releaseAvailability = resolve;
  });
  runtime.deps.createExternal = () => {
    const index = terminalIndex;
    terminalIndex += 1;
    return {
      assertAvailable: async () => {
        availabilityCount += 1;
        if (availabilityCount === 2) releaseAvailability();
        await availabilityReleased;
        return "alacritty";
      },
      spawnSplit: async (options) => {
        if (index === 1) throw new ExternalLaunchError("second launch denied", false);
        const transport = runtime.transports[0];
        assert.ok(transport);
        transport.peers.push({
          protocolVersion: 2,
          sessionId: "successful-child",
          endpointId: "c".repeat(24),
          cwd: options.cwd,
          pid: 789,
          launchId: runtime.launcherEnvironments.at(-1)?.PI_SWARM_LAUNCH_ID,
          acceptsRequests: false,
        });
        return { terminalId: "successful-terminal", version: "alacritty" };
      },
    };
  };
  const controller = new SwarmController(runtime.mock.pi, runtime.deps);
  const context = createMockContext({ mode: "tui", hasUI: true, confirm: async () => true });
  await controller.sessionStart({ reason: "startup" }, context.ctx);
  const results = await Promise.allSettled([
    controller.spawn(context.ctx, { name: "First" }),
    controller.spawn(context.ctx, { name: "Second" }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await controller.snapshot()).connected, true);
  assert.equal(runtime.transports[0]?.stopped, 0);
  await controller.sessionShutdown({ reason: "quit" }, context.ctx);
  assert.equal(runtime.transports[0]?.stopped, 1);
});

test("spawn rejects an overlong canonical cwd before side effects", async () => {
  const { mock, deps, transports, splitCalls } = harness();
  const controller = new SwarmController(mock.pi, deps);
  const context = createMockContext({ mode: "tui", hasUI: true, confirm: async () => true });
  await controller.sessionStart({ reason: "startup" }, context.ctx);
  await assert.rejects(controller.spawn(context.ctx, { cwd: "x".repeat(5_000) }), /cwd/u);
  assert.equal(transports.length, 0);
  assert.equal(splitCalls.length, 0);
  await controller.sessionShutdown({ reason: "quit" }, context.ctx);
});

test("spawn rejects unsupported modes and cancellation before side effects", async () => {
  const firstHarness = harness();
  const first = new SwarmController(firstHarness.mock.pi, firstHarness.deps);
  const json = createMockContext({ mode: "json", hasUI: false });
  await first.sessionStart({ reason: "startup" }, json.ctx);
  await assert.rejects(first.spawn(json.ctx, {}), /TUI or RPC/u);
  assert.equal(firstHarness.transports.length, 0);
  assert.equal(firstHarness.splitCalls.length, 0);
  await first.sessionShutdown({ reason: "quit" }, json.ctx);

  const secondHarness = harness();
  const second = new SwarmController(secondHarness.mock.pi, secondHarness.deps);
  const cancelled = createMockContext({ mode: "tui", hasUI: true, confirm: async () => false });
  await second.sessionStart({ reason: "startup" }, cancelled.ctx);
  await assert.rejects(second.spawn(cancelled.ctx, {}), /cancelled/u);
  assert.equal(secondHarness.transports.length, 0);
  assert.equal(secondHarness.splitCalls.length, 0);
  await second.sessionShutdown({ reason: "quit" }, cancelled.ctx);
});

test("session shutdown suppresses a split after delayed launcher creation", async () => {
  const runtime = harness();
  let signalLauncherStarted!: () => void;
  const launcherStarted = new Promise<void>((resolve) => {
    signalLauncherStarted = resolve;
  });
  let releaseLauncher!: () => void;
  const launcherReleased = new Promise<void>((resolve) => {
    releaseLauncher = resolve;
  });
  let launcherCleaned = false;
  runtime.deps.createLauncher = async () => {
    signalLauncherStarted();
    await launcherReleased;
    return {
      path: "/tmp/pi-swarm-test/launch.sh",
      command: "/tmp/pi-swarm-test/launch.sh",
      cleanup: async () => {
        launcherCleaned = true;
      },
    };
  };
  const controller = new SwarmController(runtime.mock.pi, runtime.deps);
  const context = createMockContext({ mode: "tui", hasUI: true, confirm: async () => true });
  await controller.sessionStart({ reason: "startup" }, context.ctx);
  const spawning = controller.spawn(context.ctx, {});
  await launcherStarted;
  const shuttingDown = controller.sessionShutdown({ reason: "quit" }, context.ctx);
  releaseLauncher();
  await assert.rejects(spawning, /stale|aborted/u);
  await shuttingDown;
  assert.equal(runtime.splitCalls.length, 0);
  assert.equal(launcherCleaned, true);
});

test("session shutdown waits for an in-flight launch to release its launcher", async () => {
  const runtime = harness({ ready: false });
  let signalSleepEntered!: () => void;
  const sleepEntered = new Promise<void>((resolve) => {
    signalSleepEntered = resolve;
  });
  runtime.deps.sleep = async (_milliseconds, signal) => {
    signalSleepEntered();
    await new Promise<void>((_resolve, reject) => {
      const abort = () => reject(new Error("launch wait aborted"));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  };
  let releaseCleanup!: () => void;
  let signalCleanupStarted!: () => void;
  const cleanupStarted = new Promise<void>((resolve) => {
    signalCleanupStarted = resolve;
  });
  const cleanupReleased = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });
  runtime.deps.createLauncher = async () => ({
    path: "/tmp/pi-swarm-test/launch.sh",
    command: "/tmp/pi-swarm-test/launch.sh",
    cleanup: async () => {
      signalCleanupStarted();
      await cleanupReleased;
    },
  });
  const controller = new SwarmController(runtime.mock.pi, runtime.deps);
  const context = createMockContext({ mode: "tui", hasUI: true, confirm: async () => true });
  await controller.sessionStart({ reason: "startup" }, context.ctx);
  const spawning = controller.spawn(context.ctx, {});
  await sleepEntered;
  let shutdownResolved = false;
  const shuttingDown = controller.sessionShutdown({ reason: "quit" }, context.ctx).then(() => {
    shutdownResolved = true;
  });
  await cleanupStarted;
  const shutdownState = await Promise.race([
    shuttingDown.then(() => "resolved" as const),
    new Promise<"pending">((resolve) => setImmediate(() => resolve("pending"))),
  ]);
  assert.equal(shutdownState, "pending");
  assert.equal(shutdownResolved, false);
  releaseCleanup();
  await assert.rejects(spawning, /split|ready|aborted/u);
  await shuttingDown;
  assert.equal(context.statuses.get("swarm"), undefined);
});

test("pre-split failure rolls back an automatic group while readiness timeout keeps it", async () => {
  const failedHarness = harness({ launchError: new ExternalLaunchError("denied", false) });
  const failed = new SwarmController(failedHarness.mock.pi, failedHarness.deps);
  const firstContext = createMockContext({ mode: "tui", hasUI: true, confirm: async () => true });
  await failed.sessionStart({ reason: "startup" }, firstContext.ctx);
  await assert.rejects(failed.spawn(firstContext.ctx, {}), /denied/u);
  assert.equal(failedHarness.transports[0]?.stopped, 1);
  assert.equal(failedHarness.launcherCleaned, true);
  assert.equal((await failed.snapshot()).connected, false);
  await failed.sessionShutdown({ reason: "quit" }, firstContext.ctx);

  const timeoutHarness = harness({ ready: false });
  const timeout = new SwarmController(timeoutHarness.mock.pi, timeoutHarness.deps);
  const secondContext = createMockContext({ mode: "tui", hasUI: true, confirm: async () => true });
  await timeout.sessionStart({ reason: "startup" }, secondContext.ctx);
  await assert.rejects(
    timeout.spawn(secondContext.ctx, {}),
    (error: unknown) => error instanceof ExternalLaunchError && error.splitCreated,
  );
  assert.equal(timeoutHarness.launcherCleaned, true);
  assert.equal((await timeout.snapshot()).connected, true);
  await timeout.sessionShutdown({ reason: "quit" }, secondContext.ctx);
});

function memorySettingsRuntime(
  overrides: Partial<SwarmSettings> = {},
  issue?: string,
): SwarmSettingsRuntime & {
  calls: { reload: number; flush: number };
  patches: SwarmSettingsPatch[];
} {
  let state: SwarmSettingsState = {
    settings: { ...DEFAULT_SWARM_SETTINGS, ...overrides },
    sources: {
      colorPalette: Object.hasOwn(overrides, "colorPalette") ? "user" : "built-in",
      confirmSessionLaunch: Object.hasOwn(overrides, "confirmSessionLaunch") ? "user" : "built-in",
      externalCommand: Object.hasOwn(overrides, "externalCommand") ? "user" : "built-in",
      pinToLeadWorkspace: Object.hasOwn(overrides, "pinToLeadWorkspace") ? "user" : "built-in",
      autoName: Object.hasOwn(overrides, "autoName") ? "user" : "built-in",
      autoNameModel: Object.hasOwn(overrides, "autoNameModel") ? "user" : "built-in",
    },
    canSave: issue === undefined,
    ...(issue ? { issue: { kind: "invalid", message: issue } } : {}),
  };
  const calls = { reload: 0, flush: 0 };
  const patches: SwarmSettingsPatch[] = [];
  return {
    calls,
    patches,
    get: () => state,
    getPath: () => "/tmp/pi-agent-swarm.json",
    reload: async () => {
      calls.reload += 1;
      return state;
    },
    update: async (patch) => {
      patches.push(patch);
      state = { ...state, settings: { ...state.settings, ...patch } };
      return state;
    },
    flush: async () => {
      calls.flush += 1;
    },
  };
}
