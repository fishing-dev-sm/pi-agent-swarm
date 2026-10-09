import assert from "node:assert/strict";
import { test } from "vitest";
import { createMockContext } from "../../../test/support.js";
import {
  AUTO_NAME_MAX_ATTEMPTS,
  AUTO_NAME_MAX_TITLE_CHARS,
  AUTO_NAME_TURN_THRESHOLD,
  AutoNamer,
  buildAutoNamePrompt,
  collectAutoNameMessages,
  isAutoNameModel,
  isDefaultManagerName,
  resolveAutoNameModel,
  toAutoName,
} from "../src/auto-name.js";

test("isDefaultManagerName matches only the MANAGER-<id8> bootstrap name", () => {
  assert.equal(isDefaultManagerName("MANAGER-0a1b2c3d"), true);
  assert.equal(isDefaultManagerName("MANAGER-deadbeef"), true);
  assert.equal(isDefaultManagerName("MAN-修复登录页样式"), false);
  assert.equal(isDefaultManagerName("MANAGER-short"), false);
  // Non-hex session ids (for example a hyphen inside the first 8 characters)
  // still produce the bootstrap name shape.
  assert.equal(isDefaultManagerName("MANAGER-test-ses"), true);
  assert.equal(isDefaultManagerName("MANAGER-0A1B2C3D"), true);
  assert.equal(isDefaultManagerName("my-manager-0a1b2c3d"), false);
  assert.equal(isDefaultManagerName(undefined), false);
});

test("isAutoNameModel validates the provider/id shape", () => {
  assert.equal(isAutoNameModel("openai/gpt-5-mini"), true);
  assert.equal(isAutoNameModel("deepseek/deepseek-v4-pro"), true);
  assert.equal(isAutoNameModel("no-slash"), false);
  assert.equal(isAutoNameModel("provider/"), false);
  assert.equal(isAutoNameModel("/model"), false);
  assert.equal(isAutoNameModel("pro vider/model"), false);
  assert.equal(isAutoNameModel("provider/mo del"), false);
});

test("toAutoName sanitizes model output into a MAN- name", () => {
  assert.equal(toAutoName("修复登录页样式"), "MAN-修复登录页样式");
  // Quotes, markdown emphasis, and trailing punctuation are stripped.
  assert.equal(toAutoName('"Add payments API retry".'), "MAN-Add payments API retry");
  assert.equal(toAutoName("`**调试渲染卡顿**`。"), "MAN-调试渲染卡顿");
  // Newlines collapse to spaces and terminal controls are removed.
  assert.equal(toAutoName("第一行标题\n解释说明的第二行"), "MAN-第一行标题 解释说明的第二行");
  assert.equal(toAutoName("标题\u0007带控制符"), "MAN-标题带控制符");
  // Long titles are truncated to the character budget by code points.
  const long = "这是一个非常非常长的标题它一定会超过二十四字符的限制所以需要截断处理";
  const truncated = toAutoName(long);
  assert.ok(truncated);
  assert.equal([...truncated.slice(4)].length, AUTO_NAME_MAX_TITLE_CHARS);
  assert.equal(toAutoName(""), undefined);
  assert.equal(toAutoName("   \n  "), undefined);
  assert.equal(toAutoName('"""'), undefined);
  assert.equal(toAutoName(undefined), undefined);
  // A truncated name always fits the 200-byte transport name budget.
  assert.ok(Buffer.byteLength(toAutoName("汉".repeat(40)) ?? "", "utf8") <= 200);
});

test("collectAutoNameMessages keeps the first user messages with caps", () => {
  const userEntry = (text: string) => ({
    type: "message",
    message: { role: "user", content: text, timestamp: 1 },
  });
  const context = createMockContext({
    sessionManager: {
      getSessionId: () => "s",
      getBranch: () => [
        { type: "custom_message", customType: "x" },
        { type: "message", message: { role: "assistant", content: [], timestamp: 0 } },
        userEntry("第一个问题"),
        userEntry(""),
        userEntry("第二个问题"),
        { type: "message", message: { role: "user", content: [{ type: "text", text: "第三个问题" }], timestamp: 2 } },
        userEntry("第四个问题"),
      ],
    },
  });
  assert.deepEqual(collectAutoNameMessages(context.ctx), ["第一个问题", "第二个问题", "第三个问题"]);

  const huge = createMockContext({
    sessionManager: {
      getSessionId: () => "s",
      getBranch: () => [userEntry("字".repeat(1_000))],
    },
  });
  assert.equal([...collectAutoNameMessages(huge.ctx)[0]].length, 500);
});

test("buildAutoNamePrompt lists the messages and the output rules", () => {
  const prompt = buildAutoNamePrompt(["帮我修复登录页", "还有样式问题"]);
  assert.match(prompt, /1\. 帮我修复登录页/u);
  assert.match(prompt, /2\. 还有样式问题/u);
  assert.match(prompt, /only the title/u);
});

test("resolveAutoNameModel prefers the configured override and falls back to the current model", () => {
  const current = { provider: "current", id: "model" };
  const override = { provider: "other", id: "cheap" };
  const context = createMockContext({
    model: current,
    modelRegistry: { find: (provider: string, id: string) => (id === "cheap" ? { ...override, provider } : undefined) },
  });
  assert.equal(resolveAutoNameModel(context.ctx, undefined), current);
  assert.deepEqual(resolveAutoNameModel(context.ctx, "other/cheap"), override);
  assert.equal(resolveAutoNameModel(context.ctx, "other/missing"), undefined);
});

test("AutoNamer fires on the threshold turn and retries while the default name stands", () => {
  const namer = new AutoNamer();
  for (let turn = 1; turn < AUTO_NAME_TURN_THRESHOLD; turn++) {
    assert.equal(namer.noteTurn("MANAGER-0a1b2c3d", true), false);
  }
  // One attempt per turn, retried until the attempt budget runs out.
  for (let attempt = 0; attempt < AUTO_NAME_MAX_ATTEMPTS; attempt++) {
    assert.equal(namer.noteTurn("MANAGER-0a1b2c3d", true), true);
  }
  assert.equal(namer.noteTurn("MANAGER-0a1b2c3d", true), false);
});

test("AutoNamer settles permanently once the attempt succeeds", () => {
  const namer = new AutoNamer();
  for (let turn = 1; turn < AUTO_NAME_TURN_THRESHOLD; turn++) namer.noteTurn("MANAGER-0a1b2c3d", true);
  assert.equal(namer.noteTurn("MANAGER-0a1b2c3d", true), true);
  // The applied MAN-<title> name is not a default name, so later turns settle.
  assert.equal(namer.noteTurn("MAN-调试构建脚本", true), false);
  assert.equal(namer.noteTurn("MAN-调试构建脚本", true), false);
});

test("AutoNamer stays silent when disabled or when the user owns the name", () => {
  const disabled = new AutoNamer();
  for (let turn = 0; turn < AUTO_NAME_TURN_THRESHOLD; turn++) {
    disabled.noteTurn("MANAGER-0a1b2c3d", false);
  }
  // Disabled turns consume no attempt, so enabling later still fires.
  assert.equal(disabled.noteTurn("MANAGER-0a1b2c3d", true), true);

  const renamed = new AutoNamer();
  renamed.noteExternalName("我的窗口");
  for (let turn = 0; turn < AUTO_NAME_TURN_THRESHOLD; turn++) {
    assert.equal(renamed.noteTurn("我的窗口", true), false);
  }

  // The bootstrap MANAGER-<id> name is not treated as a user rename.
  const bootstrap = new AutoNamer();
  bootstrap.noteExternalName("MANAGER-0a1b2c3d");
  for (let turn = 1; turn < AUTO_NAME_TURN_THRESHOLD; turn++) bootstrap.noteTurn("MANAGER-0a1b2c3d", true);
  assert.equal(bootstrap.noteTurn("MANAGER-0a1b2c3d", true), true);

  // A cleared name also counts as the user taking over.
  const cleared = new AutoNamer();
  cleared.noteExternalName(undefined);
  for (let turn = 0; turn < AUTO_NAME_TURN_THRESHOLD; turn++) {
    assert.equal(cleared.noteTurn(undefined, true), false);
  }

  // A custom current name at the threshold turn blocks the attempt.
  const custom = new AutoNamer();
  for (let turn = 1; turn < AUTO_NAME_TURN_THRESHOLD; turn++) custom.noteTurn("MANAGER-0a1b2c3d", true);
  assert.equal(custom.noteTurn("手动命名", true), false);
});

test("AutoNamer reset re-arms the one-shot attempt", () => {
  const namer = new AutoNamer();
  for (let turn = 0; turn < AUTO_NAME_TURN_THRESHOLD; turn++) namer.noteTurn("MANAGER-0a1b2c3d", true);
  namer.reset();
  for (let turn = 1; turn < AUTO_NAME_TURN_THRESHOLD; turn++) namer.noteTurn("MANAGER-0a1b2c3d", true);
  assert.equal(namer.noteTurn("MANAGER-0a1b2c3d", true), true);
});
