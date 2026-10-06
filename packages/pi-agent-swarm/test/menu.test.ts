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
    ...overrides,
  };
  return { source: value, calls };
}

test("main menu exposes Spawn, Rename, and Set color actions", () => {
  const { source: menuSource } = source();
  const { menu } = createSwarmMenu(menuSource);
  const main = menu.screens.main({ state: disconnected });
  assert.equal(main.kind, "actions");
  if (main.kind !== "actions") assert.fail("Expected actions screen");
  assert.deepEqual(
    main.items.map(({ label }) => label),
    ["Spawn", "Rename", "Set color"],
  );
  const spawnItem = main.items[0];
  assert.ok(spawnItem && "action" in spawnItem);
  assert.equal(spawnItem && "action" in spawnItem ? spawnItem.action : undefined, "spawn");
  // The spawn action opens nested select/input dialogs, so it must not declare a busyLabel:
  // a busyLabel wraps the action in a blocking task loader that would swallow those dialogs.
  assert.ok(!("busyLabel" in spawnItem));
  // Rename and Set color also open nested input/select dialogs, so they must not declare one either.
  const renameItem = main.items[1];
  const colorItem = main.items[2];
  assert.ok(renameItem && "action" in renameItem);
  assert.ok(colorItem && "action" in colorItem);
  assert.ok(!("busyLabel" in renameItem));
  assert.ok(!("busyLabel" in colorItem));
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
