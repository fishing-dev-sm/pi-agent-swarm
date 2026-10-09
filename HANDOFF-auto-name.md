# 自动命名功能交接文档（MAN-<标题>）

> 日期：2026-10-08 ｜ 状态：**完成并已发布**（用户真实环境实测通过，第二轮修复后重试机制生效）｜ 包：`pi-agent-swarm`（minor changeset 已添加）

## 需求背景

人类启动的 Pi 会话此前自动命名为 `MANAGER-<sessionId前8位>`，无语义，历史记录中难以辨认窗口用途。本次实现：根据用户前三次对话总结窗口真实用途并自动命名；顺带修复 `/name` 改名后 footer/roster 不立即刷新的 bug。

## 行为规格

- **触发**：仅人类启动的 manager 会话（`!envelope && !handoff` 分支），第 3 个 `turn_end` 后后台异步命名；失败在后续 turn 重试，每会话最多 3 次；swarm 子会话与 reload 会话不参与。
- **命名格式**：`MAN-<标题>`。取前 3 条用户消息（每条截 500 字符，总长 2000 字符）→ 一次性 completion → 清洗（去终端控制字符/引号/markdown 噪声/首行）→ 截断 24 字符 → 加 `MAN-` 前缀（24 CJK 字符共 76 字节，远低于 200 字节名字上限）。
- **模型**：默认 `ctx.model`（必然已认证，无需额外配置）；可选设置 `autoNameModel`（`provider/id`）覆盖，无法解析时告警一次并保留默认名。
- **开关**：`autoName`（默认 `true`）。
- **保护**：用户手动命名（`/name` 或 `/swarm` 菜单 rename）后永久不再自动改；completion 飞行期间用户改名优先（应用前复检当前名仍为默认名才写入）；任何失败静默回退 `MANAGER-<id8>` 并写入 `pi-swarm-auto-name` 诊断 entry。
- **同步**：走 `setOwnName()` 路径，同时更新 `pi.setSessionName` 与 swarm roster（`transport.setName`）。

## 设置（`~/.pi/agent/pi-agent-swarm.json`）

```json
{
  "autoName": true,
  "autoNameModel": "anthropic/claude-haiku-4-5"
}
```

| 设置 | 值 | 默认 | 行为 |
| --- | --- | --- | --- |
| `autoName` | `true`/`false` | `true` | 第 3 轮完成后将会话名从 `MANAGER-<id>` 改为 `MAN-<标题>`；用户自己命名后永久让位 |
| `autoNameModel` | `provider/id` | 未设置 | 命名 completion 所用模型；未设置用当前模型；无法解析时告警并保留默认名 |

## Bug 修复：/name 不立即刷新

新增 `session_info_changed` 监听（`SwarmController.noteSessionInfoChanged`）：外部改名时同步 `membership.transport.setName(name)` 并立即 `renderFooterStatus`。自身自动命名通过 `applyingAutoName` 标记避免被误判为用户手动命名。

## 文件变更

| 文件 | 内容 |
| --- | --- |
| `packages/pi-agent-swarm/src/auto-name.ts`（新） | 常量（`AUTO_NAME_PREFIX="MAN-"`、阈值 3、标题 24 字符、消息 500/2000、超时 30s）；`isDefaultManagerName`（`/^MANAGER-\S{8}$/u`）、`isAutoNameModel`、`toAutoName`、`collectAutoNameMessages`、`buildAutoNamePrompt`、`resolveAutoNameModel`、`completeSessionTitle`（默认 `modelRegistry.complete` 实现）；`AutoNamer` 状态机 |
| `packages/pi-agent-swarm/src/settings.ts` | `SwarmSettings` 加 `autoName`/`autoNameModel`，校验、来源、运行时同步更新 |
| `packages/pi-agent-swarm/src/swarm-controller.ts` | `noteTurnEnd`（:1198，返回 tracked promise）、`noteSessionInfoChanged`（:1212）、`runAutoName`（:1225，`AbortSignal.any` + 30s 超时 + `isCurrent` 复检 + 全程静默 catch）；命名任务纳入 `ownedTasks`，shutdown 时等待 |
| `packages/pi-agent-swarm/src/pi-agent-swarm.ts` | 注册 `turn_end`、`session_info_changed` 事件 |
| `packages/pi-agent-swarm/test/auto-name.test.ts`（新） | 纯函数与状态机单测 |
| `packages/pi-agent-swarm/test/settings.test.ts` 等 4 个测试文件 | 新字段断言 + 6 个集成测试（happy path、skip child/disabled/user-named、rename-during-completion wins、failure silent、autoNameModel 不可解析告警、/name 同步 transport+footer） |
| `packages/pi-agent-swarm/README.md` | ⚙️ Settings 表格新增两行 |
| `.changeset/auto-name-manager-sessions.md` | minor changeset |

## 实现过程中发现并修复的问题

1. **`isDefaultManagerName` 正则过严**：初版 `[0-9a-f]{8}` 不匹配含连字符的 session id（如 `test-session` → `test-ses`），导致 `noteTurn` 把默认名当成用户自定义名而跳过命名。已放宽为 `\S{8}`（UUID 前 8 位必为 hex，真实环境本就不受影响，但 mock/自定义 id 需要覆盖）。
2. **`toAutoName` 尾部清洗缺 `*`**：` `**标题**` ` 这类输出尾部残留 `**`，已补齐字符类。

## 验证结果

- **真实环境端到端验证通过**（用户实测，第二轮修复后）：新窗口对话后窗口名自动变为 `MAN-<标题>`
- `npm run check` ✅（build / biome / boundaries / typecheck 全绿）
- `npm test` ✅ 155 个测试全绿（含重试成功、失败诊断 entry、AutoNamer 重试语义等新用例）
- dist 构建产物包含新代码；smoke 确认默认命名 `MANAGER-<id8>` 生效

## 环境备注：本地模型为单线程部署

当前会话使用的 `qwen3.8-flash`（provider `qwen-local`）是本地部署，**单线程、一次只能服务一个请求**。任何并行发起的 Pi 会话/smoke（如 `pi -p …`）都会与主会话争抢同一模型槽位，双方互相排队，表现为“挂起”、无输出直至超时。今后在本机做 live smoke 时：

- 避免与主会话并发调用模型；需要 smoke 时使用长超时排队等待（实测 280s 内可排到）；
- 判断“模型卡顿”类问题时先排除槽位争抢，不要误判为 provider 不稳定或扩展 bug。

## 真实环境根因与修复（2026-10-08 第二轮）

用户实测新开项目对话后未改名。根因：**单线程本地模型排队 + 30s 超时 + 一次性不重试**。第 3 轮 `turn_end` 触发命名时，completion 请求排进 qwen3.8-flash 本地单槽队列（用户正连续发长推理请求），30s 超时后静默放弃且永不重试。修复：

- `AUTO_NAME_TIMEOUT_MS` 30s → 120s；
- 失败后在后续 `turn_end` 重试，每会话最多 `AUTO_NAME_MAX_ATTEMPTS = 3` 次（`AutoNamer` 状态机：`settled` 一次性改为 `attempts` 计数；命名成功后名字不再是默认名，自然永久停止）；
- controller 加 `autoNameInFlight` 守卫，completion 飞行期间不并发第二个命名请求；
- 失败经 `pi.appendEntry("pi-swarm-auto-name", { ok: false, error })` 写入会话文件，可事后诊断，不打扰 UI；
- 排查过程中排除的假设：token 预算（pi complete 默认用 model.maxTokens=65536，且 curl 实测不传 max_tokens 服务器也正常返回标题）、消息提取（user content 为 list 已兼容）、扩展未加载（全局 settings.json 指向仓库 dist，已确认新代码）。

## 已知事项（均与本次改动无关，已在干净 HEAD 复现验证）

1. **reload 测试 flake**：`lead record survives reload…` 等测试在系统高负载下间歇失败，HEAD 上同样复现。
2. **~~live-provider smoke 受限~~（已澄清并完成）**：验证期间 smoke 间歇挂起的原因已查明——`qwen3.8-flash` 是本地单线程部署，smoke 的 `pi -p` 请求与主会话争抢同一模型槽位导致互相排队，并非 provider 不稳定。加长超时排队后 smoke 成功：dist 加载的扩展在真实 `session_start` 中完成默认命名，session 文件 `…/--home-sim-code-pi-swarm--/2026-10-08T04-13-42-101Z_01a119b7-….jsonl` 中确认 `"name":"MANAGER-01a119b7"`（= sessionId 前 8 位）。第 3 轮自动改名由确定性集成测试覆盖（print 模式单轮无法触发 3 轮）。**仍建议在真实交互窗口开三轮对话做一次端到端确认**（第 3 轮后窗口名应变为 `MAN-<标题>`，footer 同步刷新）。

## 关键设计决策（拍板记录）

- 用当前模型而非自动挑选"最便宜"模型：必然已认证、每会话一次调用成本可忽略；自动挑模型需遍历 catalog + 查 pricing + 校验 auth，违背 KISS。
- 第 3 轮触发而非更早：前两轮上下文太少，标题质量差。
- 一次性、不重试：命名是锦上添花，失败保留默认名即可。
