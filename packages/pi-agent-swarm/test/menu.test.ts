import assert from "node:assert/strict";
import { test } from "vitest";
import { createMockContext } from "../../../test/support.js";
import { createSwarmMenu, type SwarmMenuSource, type SwarmMenuState } from "../src/menu.js";
import type { SpawnSessionInput } from "../src/swarm-controller.js";

const disconnected: SwarmMenuState = {
  connected: false,
  acceptsRequests: false,
  peers: [],
};

function source(overrides: Partial<SwarmMenuSource> = {}) {
  const calls: unknown[] = [];
  const value: SwarmMenuSource = {
    snapshot: async () => disconnected,
    spawn: async (_ctx, input) => {
      calls.push({ kind: "spawn", input });
    },
    rename: async (_ctx, name) => {
      calls.push({ kind: "rename", name });
    },
    setColor: async (_ctx, color) => {
      calls.push({ kind: "setColor", color });
    },
    setPalette: async (_ctx, palette) => {
      calls.push({ kind: "setPalette", palette });
    },
    setRequests: async (_ctx, value) => {
      calls.push({ kind: "setRequests", value });
    },
    ...overrides,
  };
  return { source: value, calls };
}

test("main menu exposes spawn, session badge, and follow-up request actions", () => {
  const { source: menuSource } = source();
  const { menu } = createSwarmMenu(menuSource);
  const main = menu.screens.main({ state: disconnected });
  assert.equal(main.kind, "actions");
  if (main.kind !== "actions") assert.fail("Expected actions screen");
  assert.deepEqual(
    main.items.map(({ label }) => label),
    ["Spawn", "Rename", "Set color", "Set theme", "Follow-up requests: blocked"],
  );
  const spawnItem = main.items[0];
  assert.ok(spawnItem && "action" in spawnItem);
  assert.equal(spawnItem && "action" in spawnItem ? spawnItem.action : undefined, "spawn");
  // The spawn action opens nested select/input dialogs, so it must not declare a busyLabel:
  // a busyLabel wraps the action in a blocking task loader that would swallow those dialogs.
  assert.ok(!("busyLabel" in spawnItem));
  // Rename, Set color, and Set theme also open nested input/select dialogs, so they must not declare one either.
  const renameItem = main.items[1];
  const colorItem = main.items[2];
  const themeItem = main.items[3];
  assert.ok(renameItem && "action" in renameItem);
  assert.ok(colorItem && "action" in colorItem);
  assert.ok(themeItem && "action" in themeItem);
  assert.ok(!("busyLabel" in renameItem));
  assert.ok(!("busyLabel" in colorItem));
  assert.ok(!("busyLabel" in themeItem));
  const requestsItem = main.items[4];
  assert.ok(requestsItem && "action" in requestsItem);
  assert.equal(requestsItem && "action" in requestsItem ? requestsItem.action : undefined, "setRequests");
});

test("spawn defers automatic backend resolution to the controller", async () => {
  const { source: menuSource, calls } = source();
  const { menu } = createSwarmMenu(menuSource);
  const selectionTitles: string[] = [];
  const selectionOptions: string[][] = [];
  const context = createMockContext({
    mode: "tui",
    hasUI: true,
    select: async (title: string, options: string[]) => {
      selectionTitles.push(title);
      selectionOptions.push(options);
      return title === "Terminal window direction" ? "Down" : "Block (default)";
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
  assert.deepEqual(selectionTitles, ["Terminal window direction", "Follow-up agent requests"]);
  assert.deepEqual(selectionOptions, [
    ["Right", "Down", "Left", "Up"],
    ["Block (default)", "Allow paid turns from trusted peers"],
  ]);
  assert.deepEqual(calls, [
    {
      kind: "spawn",
      input: {
        direction: "down",
        task: "Investigate tests",
        allowRequests: false,
      } satisfies SpawnSessionInput,
    },
  ]);
});

test("spawn can explicitly allow follow-up requests", async () => {
  const { source: menuSource, calls } = source();
  const { menu } = createSwarmMenu(menuSource);
  const context = createMockContext({
    mode: "tui",
    hasUI: true,
    select: async (title: string) =>
      title === "Terminal window direction" ? "Right" : "Allow paid turns from trusted peers",
    input: async () => "Continue after review",
  });
  await menu.actions.spawn({
    ctx: context.ctx,
    state: disconnected,
    signal: new AbortController().signal,
    itemId: "spawn",
  });
  assert.deepEqual(calls, [
    {
      kind: "spawn",
      input: { direction: "right", task: "Continue after review", allowRequests: true },
    },
  ]);
});

test("cancelled follow-up request choice creates no spawn side effects", async () => {
  const { source: menuSource, calls } = source();
  const { menu } = createSwarmMenu(menuSource);
  const context = createMockContext({
    mode: "tui",
    hasUI: true,
    select: async (title: string) => (title === "Terminal window direction" ? "Right" : undefined),
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

test("request policy action toggles the current session and stays open", async () => {
  const { source: menuSource, calls } = source();
  const { menu } = createSwarmMenu(menuSource);
  const context = createMockContext({ mode: "tui", hasUI: true });
  const state = { ...disconnected, connected: true, acceptsRequests: false };
  assert.deepEqual(
    await menu.actions.setRequests({
      ctx: context.ctx,
      state,
      signal: new AbortController().signal,
      itemId: "requests",
    }),
    { kind: "stay" },
  );
  assert.deepEqual(calls, [{ kind: "setRequests", value: true }]);
  const main = menu.screens.main({ state: { ...state, acceptsRequests: true } });
  assert.equal(main.kind, "actions");
  if (main.kind === "actions") assert.equal(main.items[4]?.label, "Follow-up requests: allowed");
});

test("cancelled direction choice creates no spawn side effects", async () => {
  const { source: menuSource, calls } = source();
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

test("rename submits the entered name and stays open", async () => {
  const { source: menuSource, calls } = source();
  const { menu } = createSwarmMenu(menuSource);
  const context = createMockContext({
    mode: "tui",
    hasUI: true,
    input: async () => "my-worker",
  });
  assert.deepEqual(
    await menu.actions.rename({
      ctx: context.ctx,
      state: disconnected,
      signal: new AbortController().signal,
      itemId: "rename",
    }),
    { kind: "stay" },
  );
  assert.deepEqual(calls, [{ kind: "rename", name: "my-worker" }]);
});

test("cancelled or blank rename creates no side effects", async () => {
  const { source: menuSource, calls } = source();
  const { menu } = createSwarmMenu(menuSource);
  for (const answer of [undefined, "", "   "]) {
    const context = createMockContext({
      mode: "tui",
      hasUI: true,
      input: async () => answer,
    });
    assert.deepEqual(
      await menu.actions.rename({
        ctx: context.ctx,
        state: disconnected,
        signal: new AbortController().signal,
        itemId: "rename",
      }),
      { kind: "stay" },
    );
  }
  assert.deepEqual(calls, []);
});

test("set color submits the chosen palette name and stays open", async () => {
  const { source: menuSource, calls } = source();
  const { menu } = createSwarmMenu(menuSource);
  const selectionTitles: string[] = [];
  const selectionOptions: string[][] = [];
  const context = createMockContext({
    mode: "tui",
    hasUI: true,
    select: async (title: string, options: string[]) => {
      selectionTitles.push(title);
      selectionOptions.push(options);
      return "blue";
    },
  });
  assert.deepEqual(
    await menu.actions.setColor({
      ctx: context.ctx,
      state: disconnected,
      signal: new AbortController().signal,
      itemId: "color",
    }),
    { kind: "stay" },
  );
  assert.deepEqual(selectionTitles, ["Session color"]);
  assert.deepEqual(selectionOptions, [["red", "orange", "yellow", "green", "cyan", "blue", "magenta", "purple"]]);
  assert.deepEqual(calls, [{ kind: "setColor", color: "blue" }]);
});

test("set theme submits the chosen palette value and stays open", async () => {
  const { source: menuSource, calls } = source();
  const { menu } = createSwarmMenu(menuSource);
  const selectionTitles: string[] = [];
  const selectionOptions: string[][] = [];
  const context = createMockContext({
    mode: "tui",
    hasUI: true,
    select: async (title: string, options: string[]) => {
      selectionTitles.push(title);
      selectionOptions.push(options);
      return "bright (vivid GitHub colors)";
    },
  });
  assert.deepEqual(
    await menu.actions.setTheme({
      ctx: context.ctx,
      state: disconnected,
      signal: new AbortController().signal,
      itemId: "theme",
    }),
    { kind: "stay" },
  );
  assert.deepEqual(selectionTitles, ["Roster theme (badge palette)"]);
  assert.deepEqual(selectionOptions, [
    ["muted (default, low-saturation GitHub colors)", "bright (vivid GitHub colors)"],
  ]);
  assert.deepEqual(calls, [{ kind: "setPalette", palette: "bright" }]);
});

test("cancelled theme choice creates no side effects", async () => {
  const { source: menuSource, calls } = source();
  const { menu } = createSwarmMenu(menuSource);
  const context = createMockContext({
    mode: "tui",
    hasUI: true,
    select: async () => undefined,
  });
  assert.deepEqual(
    await menu.actions.setTheme({
      ctx: context.ctx,
      state: disconnected,
      signal: new AbortController().signal,
      itemId: "theme",
    }),
    { kind: "stay" },
  );
  assert.deepEqual(calls, []);
});

test("cancelled color choice creates no side effects", async () => {
  const { source: menuSource, calls } = source();
  const { menu } = createSwarmMenu(menuSource);
  const context = createMockContext({
    mode: "tui",
    hasUI: true,
    select: async () => undefined,
  });
  assert.deepEqual(
    await menu.actions.setColor({
      ctx: context.ctx,
      state: disconnected,
      signal: new AbortController().signal,
      itemId: "color",
    }),
    { kind: "stay" },
  );
  assert.deepEqual(calls, []);
});
