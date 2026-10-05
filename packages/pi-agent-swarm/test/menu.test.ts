import assert from "node:assert/strict";
import { createRpcHarness, createTuiHarness } from "@narumitw/pi-tui-kit/testing";
import { test } from "vitest";
import { createMockContext } from "../../../test/support.js";
import { createSwarmMenu, type SwarmMenuSource, type SwarmMenuState, showSwarmMenu } from "../src/menu.js";
import { DEFAULT_SWARM_SETTINGS, type SwarmSettingsPatch, type SwarmSettingsState } from "../src/settings.js";
import type { SpawnSessionInput } from "../src/swarm-controller.js";

const defaultSettings: SwarmSettingsState = {
  settings: { ...DEFAULT_SWARM_SETTINGS },
  sources: {
    confirmSessionLaunch: "built-in",
    externalCommand: "built-in",
    pinToLeadWorkspace: "built-in",
  },
  canSave: true,
};
const disconnected: SwarmMenuState = {
  connected: false,
  acceptsRequests: false,
  peers: [],
  ...defaultSettings,
  settingsPath: "/tmp/pi-agent-swarm.json",
};
const connected: SwarmMenuState = {
  connected: true,
  groupId: "a".repeat(32),
  invite: `piagentswarm:v1:${"A".repeat(43)}`,
  acceptsRequests: false,
  self: {
    protocolVersion: 2,
    sessionId: "self",
    endpointId: "a".repeat(24),
    name: "Main",
    cwd: "/tmp/main",
    pid: 123,
    acceptsRequests: false,
  },
  peers: [
    {
      protocolVersion: 2,
      sessionId: "peer",
      endpointId: "b".repeat(24),
      name: "Peer",
      cwd: "/tmp/peer",
      pid: 456,
      acceptsRequests: true,
    },
  ],
  ...defaultSettings,
  settingsPath: "/tmp/pi-agent-swarm.json",
};

function source(overrides: Partial<SwarmMenuSource> = {}) {
  const calls: unknown[] = [];
  const value: SwarmMenuSource = {
    snapshot: async () => disconnected,
    spawn: async (_ctx, input) => {
      calls.push({ kind: "spawn", input });
    },
    start: async () => {
      calls.push({ kind: "start" });
    },
    join: async (_ctx, invite) => {
      calls.push({ kind: "join", invite });
    },
    send: async (_ctx, options) => {
      calls.push({ kind: "send", options });
    },
    updateSettings: async (patch) => {
      calls.push({ kind: "settings", patch });
    },
    setAcceptsRequests: (value) => {
      calls.push({ kind: "policy", value });
    },
    leave: async () => {
      calls.push({ kind: "leave" });
    },
    ...overrides,
  };
  return { source: value, calls };
}

test("main menu exposes New Pi session first plus Settings, Status, and Help", () => {
  const first = source({ snapshot: async () => disconnected });
  const firstMenu = createSwarmMenu(first.source);
  assert.deepEqual(
    (
      firstMenu.menu.screens.main({ state: disconnected }) as unknown as {
        items: ReadonlyArray<{ label: string }>;
      }
    ).items.map(({ label }) => label),
    ["New Pi session…", "Join with invite", "Start local group", "Settings", "Status", "Help"],
  );
  const second = source({ snapshot: async () => connected });
  const secondMenu = createSwarmMenu(second.source);
  assert.deepEqual(
    (
      secondMenu.menu.screens.main({ state: connected }) as unknown as {
        items: ReadonlyArray<{ label: string }>;
      }
    ).items.map(({ label }) => label),
    [
      "New Pi session…",
      "Send message",
      "Sessions",
      "Invite another session",
      "Request policy",
      "Settings",
      "Status",
      "Help",
      "Leave group…",
    ],
  );

  const settings = firstMenu.menu.screens.settings({ state: disconnected });
  assert.equal(settings.kind, "settings");
  if (settings.kind !== "settings") assert.fail("Expected settings screen");
  assert.deepEqual(
    settings.items.map((item) => [item.id, item.currentValue]),
    [
      ["confirmSessionLaunch", "Ask"],
      ["pinToLeadWorkspace", "Off"],
    ],
  );
  assert.match((settings.lines ?? []).join("\n"), /\/tmp\/pi-agent-swarm\.json/u);

  const invalidState: SwarmMenuState = {
    ...disconnected,
    issue: { kind: "invalid", message: "invalid file" },
    canSave: false,
  };
  const invalidMain = firstMenu.menu.screens.main({ state: invalidState });
  assert.equal(invalidMain.kind, "actions");
  if (invalidMain.kind !== "actions") assert.fail("Expected actions screen");
  const invalidSettings = invalidMain.items.find((item) => item.id === "settings");
  assert.equal(invalidSettings && "to" in invalidSettings ? invalidSettings.to : undefined, "settingsInvalid");
});

test("setting actions persist exact patches and reject failed saves", async () => {
  const first = source();
  const firstMenu = createSwarmMenu(first.source).menu;
  const context = createMockContext({ mode: "tui", hasUI: true });
  assert.deepEqual(
    await firstMenu.actions.setConfirmation({
      ctx: context.ctx,
      state: disconnected,
      signal: new AbortController().signal,
      itemId: "confirmSessionLaunch",
      value: "Skip",
    }),
    { kind: "stay" },
  );
  assert.deepEqual(first.calls, [{ kind: "settings", patch: { confirmSessionLaunch: false } }]);
  assert.equal(context.notifications.at(-1)?.level, "info");

  const second = source({ updateSettings: async () => Promise.reject(new Error("save rejected")) });
  const failedContext = createMockContext({ mode: "tui", hasUI: true });
  assert.deepEqual(
    await createSwarmMenu(second.source).menu.actions.setConfirmation({
      ctx: failedContext.ctx,
      state: disconnected,
      signal: new AbortController().signal,
      itemId: "confirmSessionLaunch",
      value: "Skip",
    }),
    { kind: "rejected" },
  );
  assert.match(failedContext.notifications.at(-1)?.message ?? "", /previous value remains/u);
});

test("spawn defers automatic backend resolution to the controller", async () => {
  const { source: menuSource, calls } = source({ snapshot: async () => disconnected });
  const { menu } = createSwarmMenu(menuSource);
  const selectionTitles: string[] = [];
  const selectionOptions: string[][] = [];
  const context = createMockContext({
    mode: "tui",
    hasUI: true,
    select: async (title: string, options: string[]) => {
      selectionTitles.push(title);
      selectionOptions.push(options);
      return "Down";
    },
    input: async () => "Investigate tests",
  });
  const result = await menu.actions.spawn({
    ctx: context.ctx,
    state: disconnected,
    signal: new AbortController().signal,
    itemId: "spawn",
  });
  assert.deepEqual(result, { kind: "close" });
  assert.deepEqual(selectionTitles, ["Terminal window direction"]);
  assert.deepEqual(selectionOptions, [["Right", "Down", "Left", "Up"]]);
  assert.deepEqual(calls, [
    {
      kind: "spawn",
      input: {
        direction: "down",
        task: "Investigate tests",
      } satisfies SpawnSessionInput,
    },
  ]);
});

test("cancelled direction choice creates no spawn side effects", async () => {
  const { source: menuSource, calls } = source({ snapshot: async () => disconnected });
  const { menu } = createSwarmMenu(menuSource);
  const context = createMockContext({
    mode: "tui",
    hasUI: true,
    select: async () => undefined,
  });
  assert.deepEqual(
    await menu.actions.spawn({
      ctx: context.ctx,
      state: disconnected,
      signal: new AbortController().signal,
      itemId: "spawn",
    }),
    { kind: "stay" },
  );
  assert.deepEqual(calls, []);
});

test("cancelled dialogs create no group or join side effects", async () => {
  const { source: menuSource, calls } = source();
  const { menu } = createSwarmMenu(menuSource);
  const context = createMockContext({
    mode: "tui",
    hasUI: true,
    confirm: async () => false,
  });
  assert.deepEqual(
    await menu.actions.start({
      ctx: context.ctx,
      state: disconnected,
      signal: new AbortController().signal,
      itemId: "start",
    }),
    { kind: "stay" },
  );
  assert.deepEqual(
    await menu.actions.join({
      ctx: context.ctx,
      state: disconnected,
      signal: new AbortController().signal,
      itemId: "join",
      value: `piagentswarm:v1:${"A".repeat(43)}`,
    }),
    { kind: "stay" },
  );
  assert.deepEqual(calls, []);
});

test("request policy warns before enabling and leave requires its review action", async () => {
  const { source: menuSource, calls } = source({ snapshot: async () => connected });
  const { menu } = createSwarmMenu(menuSource);
  const context = createMockContext({ mode: "tui", hasUI: true, confirm: async () => true });
  assert.deepEqual(
    await menu.actions.setPolicy({
      ctx: context.ctx,
      state: connected,
      signal: new AbortController().signal,
      itemId: "allow",
    }),
    { kind: "to", screen: "requestPolicy" },
  );
  assert.deepEqual(
    await menu.actions.leave({
      ctx: context.ctx,
      state: connected,
      signal: new AbortController().signal,
      itemId: "leave",
    }),
    { kind: "to", screen: "main" },
  );
  assert.deepEqual(calls, [{ kind: "policy", value: true }, { kind: "leave" }]);
});

test("TUI Settings changes apply immediately and failed saves restore the previous value", async () => {
  let state = disconnected;
  const patches: SwarmSettingsPatch[] = [];
  const tui = createTuiHarness({ width: 70, rows: 24 });
  const successfulSource = source({
    snapshot: async () => state,
    updateSettings: async (patch) => {
      patches.push(patch);
      state = { ...state, settings: { ...state.settings, ...patch } };
    },
  }).source;
  const context = createMockContext({ mode: "tui", hasUI: true, custom: tui.custom });
  const running = showSwarmMenu(context.ctx, successfulSource, {
    signal: new AbortController().signal,
    isCurrent: () => true,
  });
  await tui.waitForOpen();
  for (let index = 0; index < 3; index += 1) tui.press("tui.select.down");
  tui.press("tui.select.confirm");
  await waitForOpenCount(tui, 2);
  tui.press("tui.select.confirm");
  await tui.waitForPending();
  await waitForOpenCount(tui, 3);
  tui.press("tui.select.cancel");
  await waitForOpenCount(tui, 4);
  tui.press("ctrl+c");
  await running;
  assert.deepEqual(patches, [{ confirmSessionLaunch: false }]);

  const failingTui = createTuiHarness({ width: 70, rows: 24 });
  const failedContext = createMockContext({
    mode: "tui",
    hasUI: true,
    custom: failingTui.custom,
  });
  const failing = showSwarmMenu(
    failedContext.ctx,
    source({ updateSettings: async () => Promise.reject(new Error("save rejected")) }).source,
    { signal: new AbortController().signal, isCurrent: () => true },
  );
  await failingTui.waitForOpen();
  for (let index = 0; index < 3; index += 1) failingTui.press("tui.select.down");
  failingTui.press("tui.select.confirm");
  await waitForOpenCount(failingTui, 2);
  failingTui.press("tui.select.confirm");
  await failingTui.waitForPending();
  assert.match(failingTui.render().join("\n"), /Confirm new sessions\s+Ask/u);
  failingTui.press("ctrl+c");
  await failing;
  assert.match(failedContext.notifications.at(-1)?.message ?? "", /previous value remains/u);
});

test("RPC Settings changes apply immediately through the shared menu", async () => {
  let state = disconnected;
  const patches: SwarmSettingsPatch[] = [];
  const menuSource = source({
    snapshot: async () => state,
    updateSettings: async (patch) => {
      patches.push(patch);
      state = { ...state, settings: { ...state.settings, ...patch } };
    },
  }).source;
  const rpc = createRpcHarness([
    {
      kind: "select",
      options: ["New Pi session…", "Join with invite", "Start local group", "Settings", "Status", "Help"],
      response: "Settings",
    },
    {
      kind: "select",
      options: ["Confirm new sessions (Ask)", "Pin new windows to lead workspace (Off)", "Back"],
      response: "Confirm new sessions (Ask)",
    },
    {
      kind: "select",
      options: ["Confirm new sessions (Skip)", "Pin new windows to lead workspace (Off)", "Back"],
      response: undefined,
    },
    {
      kind: "select",
      options: ["New Pi session…", "Join with invite", "Start local group", "Settings", "Status", "Help"],
      response: undefined,
    },
  ]);
  const context = createMockContext({ mode: "rpc", hasUI: true, ...rpc.ui });
  await showSwarmMenu(context.ctx, menuSource, {
    signal: new AbortController().signal,
    isCurrent: () => true,
  });
  assert.deepEqual(patches, [{ confirmSessionLaunch: false }]);
  rpc.assertConsumed();
});

async function waitForOpenCount(tui: ReturnType<typeof createTuiHarness>, expected: number): Promise<void> {
  while (tui.openCount < expected) {
    if (tui.isOpen) await Promise.resolve();
    else await tui.waitForOpen();
  }
}
