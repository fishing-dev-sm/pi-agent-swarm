import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "vitest";
import {
  createSwarmSettingsRuntime,
  DEFAULT_SWARM_SETTINGS,
  loadSwarmSettings,
  normalizeSwarmSettingsDocument,
} from "../src/settings.js";

function temporarySettings(t: TestContext) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pi-swarm-settings-"));
  t.onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, settingsPath: path.join(directory, "agent", "pi-agent-swarm.json") };
}

test("missing settings stay side-effect free until the first explicit save", async (t) => {
  const { directory, settingsPath } = temporarySettings(t);
  const loaded = await loadSwarmSettings(settingsPath);
  assert.equal(loaded.kind, "missing");
  assert.deepEqual(loaded.settings, DEFAULT_SWARM_SETTINGS);
  assert.equal(DEFAULT_SWARM_SETTINGS.pinToLeadWorkspace, false);
  assert.equal(exists(path.join(directory, "agent")), false);

  const runtime = createSwarmSettingsRuntime({ path: settingsPath });
  await runtime.reload();
  assert.equal(exists(path.join(directory, "agent")), false);
  await runtime.update({ confirmSessionLaunch: false });
  assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), {
    confirmSessionLaunch: false,
  });
});

test("normalization accepts partial settings and rejects invalid owned values", () => {
  assert.deepEqual(
    normalizeSwarmSettingsDocument({
      externalCommand: "kitty",
      confirmSessionLaunch: false,
      colorPalette: "bright",
      future: { retained: true },
    }),
    {
      settings: {
        autoName: true,
        externalCommand: "kitty",
        confirmSessionLaunch: false,
        colorPalette: "bright",
        pinToLeadWorkspace: false,
      },
      sources: {
        autoName: "built-in",
        autoNameModel: "built-in",
        externalCommand: "user",
        confirmSessionLaunch: "user",
        colorPalette: "user",
        pinToLeadWorkspace: "built-in",
      },
    },
  );
  assert.deepEqual(normalizeSwarmSettingsDocument({ pinToLeadWorkspace: true }), {
    settings: {
      autoName: true,
      colorPalette: "muted",
      confirmSessionLaunch: true,
      externalCommand: "alacritty -e",
      pinToLeadWorkspace: true,
    },
    sources: {
      autoName: "built-in",
      autoNameModel: "built-in",
      colorPalette: "built-in",
      confirmSessionLaunch: "built-in",
      externalCommand: "built-in",
      pinToLeadWorkspace: "user",
    },
  });
  assert.deepEqual(normalizeSwarmSettingsDocument({}), {
    settings: DEFAULT_SWARM_SETTINGS,
    sources: {
      autoName: "built-in",
      autoNameModel: "built-in",
      colorPalette: "built-in",
      confirmSessionLaunch: "built-in",
      externalCommand: "built-in",
      pinToLeadWorkspace: "built-in",
    },
  });
  for (const value of [
    null,
    [],
    { colorPalette: "neon" },
    { colorPalette: 5 },
    { confirmSessionLaunch: "yes" },
    { externalCommand: "" },
    { externalCommand: 5 },
    { pinToLeadWorkspace: "yes" },
    { autoName: "yes" },
    { autoName: 1 },
    { autoNameModel: 5 },
    { autoNameModel: "" },
    { autoNameModel: "no-slash" },
    { autoNameModel: "provider/" },
    { autoNameModel: "/model" },
    { autoNameModel: "pro vider/model" },
  ]) {
    assert.equal(normalizeSwarmSettingsDocument(value), undefined);
  }
});

test("updates preserve unknown fields and publish private JSON atomically", async (t) => {
  const { settingsPath } = temporarySettings(t);
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeFileSync(
    settingsPath,
    `${JSON.stringify({ confirmSessionLaunch: true, future: { retained: true } }, null, 2)}\n`,
  );
  const runtime = createSwarmSettingsRuntime({ path: settingsPath });
  await runtime.reload();
  await runtime.update({ pinToLeadWorkspace: true });
  await runtime.update({ confirmSessionLaunch: false });

  assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), {
    confirmSessionLaunch: false,
    future: { retained: true },
    pinToLeadWorkspace: true,
  });
  assert.deepEqual(runtime.get().settings, {
    autoName: true,
    colorPalette: "muted",
    confirmSessionLaunch: false,
    externalCommand: "alacritty -e",
    pinToLeadWorkspace: true,
  });
  if (process.platform !== "win32") {
    assert.equal(statSync(settingsPath).mode & 0o777, 0o600);
  }
  assert.deepEqual(listTemporaryFiles(settingsPath), []);
});

test("malformed, invalid, and invalid UTF-8 files remain unchanged and block updates", async (t) => {
  for (const contents of [
    Buffer.from("{bad json\n"),
    Buffer.from('{"pinToLeadWorkspace":"yes"}\n'),
    Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]),
  ]) {
    const { settingsPath } = temporarySettings(t);
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, contents);
    const runtime = createSwarmSettingsRuntime({ path: settingsPath });
    const state = await runtime.reload();
    assert.ok(state.issue);
    await assert.rejects(runtime.update({ confirmSessionLaunch: false }), /invalid|malformed|UTF-8/u);
    assert.deepEqual(readFileSync(settingsPath), contents);
    assert.deepEqual(runtime.get().settings, DEFAULT_SWARM_SETTINGS);
  }
});

test("publication failure retains effective state, cleans temporary files, and queue recovers", async (t) => {
  const { settingsPath } = temporarySettings(t);
  let rejectRename = true;
  const runtime = createSwarmSettingsRuntime({
    path: settingsPath,
    operations: {
      rename: async (source: Parameters<typeof rename>[0], destination: Parameters<typeof rename>[1]) => {
        if (rejectRename) throw new Error("rename rejected");
        await rename(source, destination);
      },
    },
  });
  await runtime.reload();
  await assert.rejects(runtime.update({ pinToLeadWorkspace: true }), /rename rejected/u);
  assert.deepEqual(runtime.get().settings, DEFAULT_SWARM_SETTINGS);
  assert.deepEqual(listTemporaryFiles(settingsPath), []);

  rejectRename = false;
  await runtime.update({ pinToLeadWorkspace: true });
  assert.equal(runtime.get().settings.pinToLeadWorkspace, true);
});

test("concurrent updates serialize in call order and reload waits for pending publication", async (t) => {
  const { settingsPath } = temporarySettings(t);
  let releaseFirst!: () => void;
  const firstWrite = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let writes = 0;
  const runtime = createSwarmSettingsRuntime({
    path: settingsPath,
    operations: {
      writeFile: async (
        file: Parameters<typeof writeFile>[0],
        data: Parameters<typeof writeFile>[1],
        options: Parameters<typeof writeFile>[2],
      ) => {
        writes += 1;
        if (writes === 1) await firstWrite;
        await writeFile(file, data, options);
      },
    },
  });
  await runtime.reload();
  const first = runtime.update({ externalCommand: "kitty" });
  const second = runtime.update({ confirmSessionLaunch: false });
  const reload = runtime.reload();
  await Promise.resolve();
  assert.deepEqual(runtime.get().settings, DEFAULT_SWARM_SETTINGS);
  releaseFirst();
  await Promise.all([first, second, reload, runtime.flush()]);
  assert.deepEqual(runtime.get().settings, {
    autoName: true,
    colorPalette: "muted",
    confirmSessionLaunch: false,
    externalCommand: "kitty",
    pinToLeadWorkspace: false,
  });
});

test("autoName and autoNameModel settings validate, persist, and track sources", async (t) => {
  const { settingsPath } = temporarySettings(t);
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeFileSync(
    settingsPath,
    `${JSON.stringify({ autoName: false, autoNameModel: "openai/gpt-5-mini", future: 1 }, null, 2)}\n`,
  );
  const runtime = createSwarmSettingsRuntime({ path: settingsPath });
  const loaded = await runtime.reload();
  assert.equal(loaded.settings.autoName, false);
  assert.equal(loaded.settings.autoNameModel, "openai/gpt-5-mini");
  assert.equal(loaded.sources.autoName, "user");
  assert.equal(loaded.sources.autoNameModel, "user");

  await runtime.update({ autoName: true });
  assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), {
    autoName: true,
    autoNameModel: "openai/gpt-5-mini",
    future: 1,
  });
  // Whitespace around the configured model is normalized away on load.
  assert.deepEqual(normalizeSwarmSettingsDocument({ autoNameModel: "  deepseek/deepseek-v4-pro " })?.settings, {
    autoName: true,
    autoNameModel: "deepseek/deepseek-v4-pro",
    colorPalette: "muted",
    confirmSessionLaunch: true,
    externalCommand: "alacritty -e",
    pinToLeadWorkspace: false,
  });
  await assert.rejects(runtime.update({ autoNameModel: "bad" as never }), /invalid/u);
});

function exists(target: string) {
  try {
    statSync(target);
    return true;
  } catch {
    return false;
  }
}

function listTemporaryFiles(settingsPath: string) {
  try {
    return readdirSync(path.dirname(settingsPath)).filter((name) => name.endsWith(".tmp"));
  } catch {
    return [];
  }
}
