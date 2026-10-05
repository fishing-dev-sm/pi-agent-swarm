# pi-agent-swarm 项目历史

> 本文记录本仓库（fork 自 narumiruna/pi-extensions）从想法萌发到当前的完整经过，按时间线组织。
> 记录时间：2026-10-05。文中事实以 git 提交记录与项目内验证结果为准。

## 1. 起源

用户对 pi 内置的 subagent 系统不满意。内置 subagent 是主 agent 内部派生的轻量子代理，而用户真正想要的场景是：

> 一个「项目经理」agent，向多个**全功能 agent** 派发任务，各干各的活。

这种模式下，worker 必须是和组长完全同级的、完整的 pi 会话，而不是被包在某个主会话内部的从属物。

## 2. 需求演化（走过的弯路）

在动手之前，先后评估并否定了三条路线：

1. **官方 subagent 扩展**：spawn 完整的 pi 子进程。不满足要求——子代理是 headless 的，无法中途 steer，也不落 session。
2. **RPC 方案**：被控端仍是 headless、没有 TUI；且 stdio-only 的通道无法连接到一个独立启动的会话。不满意。
3. **MCP 方案**：pi 只有 MCP 客户端能力，没有 server 能力，需要自己在中间再包一层。不满意。

三条路都被否掉后，回到第一性原理，确定了最终形态：

> **几个 agent = 几个终端窗口 = 几个实体 pi 进程。**
> 每个都是完整的 TUI，彼此平级、角色可互换、组长随时可换。

用户日常使用 i3 平铺窗口管理器，新开的终端窗口会被自动平铺，因此明确**不要 tmux**——原话是「脱裤子放屁」。

## 3. 社区调研

在 npm / GitHub 上找到三个同名的相近项目，全部 clone 下来读了源码：

| 项目 | 方案 | 结论 |
| --- | --- | --- |
| `pi-agent-swarm` | 真实 pi 会话开在 tmux / zellij / ghostty 分屏，另有消息总线 | **最贴合「实体窗口」原则**，选作基础 |
| `@tinoy/pi-agent-swarm` | worker 是 headless subagent，foreman 负责协调 | 不符合实体窗口原则，排除 |
| `@elpapi42/pi-agent-swarm` | daemon 管理 headless pi 进程 + `pif` CLI，观测靠 receive 流 | 非实体 TUI，排除 |

结论：fork `@narumiruna/pi-agent-swarm` 所在仓库（narumiruna/pi-extensions），在其基础上改装。

## 4. 实施

仓库 fork 到 `~/code/pi-agent-swarm`，上游基线为合并 PR #1446 后的 `4c6b1fb`。在 `pi-agent-swarm` 基础上分三步改装，外加一项参数增强：

1. **外部终端适配器**：新增 `external` 终端后端，通过 `alacritty -e` 打开独立窗口，由 i3 自动平铺；不依赖 tmux / zellij / ghostty。`auto` 自动检测在找不到上述复用器时回落到 `external`。
2. **每会话颜色**：内置 8 色盘；`session_spawn` 增加 `color` 参数；新增 `/color` 命令；footer 显示「●名字·角色」；peer 列表带颜色名。
3. **lead 角色**：新增 `/lead` 命令，写入共享的 `lead.json`；通过「广播通知 + 消息到达时刷新 + 5 秒轮询兜底」三重机制，保证每个窗口 footer 上的 LEADER / WORKER 角色显示正确。

另外给 `session_spawn` 增加了 `model` 参数（格式 `provider/id`），让每个 worker 可以被指定不同的模型。

以上全部在提交 **`9b507d8`**（2026-10-05，`pi-agent-swarm: external-terminal spawn, per-session color, lead role`）中落地。

## 5. 验证

- **单元测试**：110 个全部通过（同步更新了旧断言）。
- **E2E**：spawn 真实 alacritty 窗口、peer 发现与颜色、`/lead` 写入 `lead.json`、广播送达子会话，逐项验证通过。
- **实战演示一**：4 个 worker（2 个 dsv4pro + 2 个 k3）分头搜索代码，结果写到文件回收。
- **实战演示二**：2 个 worker（1 个 dsv4pro + 1 个 k3）分头找 bug。

## 6. 审查发现

两名 reviewer 共报出约 16 个 bug，合并去重后分为三类：

### 本仓库新写代码的 bug

- **HIGH**：`/color` 失效、`/lead` 无法自封、颜色跨会话泄漏、`model` 指定失败时空等 15 秒。
- **MEDIUM**：`model` 参数丢失 thinkingLevel、lead 广播污染上下文、reload 丢失颜色、lead 退出后无重选机制。
- **LOW**：`external` 适配器若干问题、footer 名字未消毒等。

### 上游 narumiruna 原有代码的 bug

- transport 把 `ETIMEDOUT` 当作死端点并删除 manifest。
- 限流器 `maxKeys` 复用问题。
- launch envelope 在校验之前就删除了环境变量。

### 测试盲区

lead / color / external / model / reload 全链路**零测试覆盖**。

## 7. 当前状态（2026-10-05 写作时刻）

- 已完成 `git commit`（`9b507d8`）：external 终端 + 每会话颜色 + lead 角色 + model 参数。
- 已派出一名 dsv4pro「修复 worker」，负责修复 HIGH-1..4 和 MEDIUM-5、7。
- 本文档由「史官」worker 撰写，作为项目的可审计历史记录。

## 8. 信息回转与 footer 可用性迭代（2026-10-05）

新 leader 接手 HANDOFF.md 后，先等修复 worker（fixer）完成 6 个 bug 修复（HIGH-1 `/color` 不生效、HIGH-2 `/lead` 无法自封、HIGH-3 颜色跨会话泄漏、HIGH-4 子端 model 不可用干等 15s+ 留孤儿窗口、MEDIUM-5 显式 model 丢 thinkingLevel、MEDIUM-7 lead 广播污染上下文），验证 tsc / biome / vitest（110 全过）/ build 全绿后提交 `5faab76`。此后围绕 footer 可用性和 leader-worker 信息对齐做了两轮迭代：

1. **footer 显示 name+id**（`abcc974`）：用户发现 `/lead` 无参数时报「Usage: /lead <session name or id>」，但 UI 上看不到任何 name/id，人类无法使用；修复为 footer 同时显示 name 和 id。
2. **reload 恢复 name/color**（`a497149`）：reload 后 footer 又丢失 name+id，根因是 reload handoff（SwarmReloadHandoff）不保存 name/color；派 K3 agent（footer-fix）在 handoff 中补上这两个字段并在 sessionStart 恢复。
3. **footer badge 样式**（`71c4963`、`fbaccdd`）：用户直接在 footer-fix 窗口 steer，要求改为三段填充 badge（swarm 色底 + 按 WCAG 对比度选字色、白底黑字 id、米黄底角色），并微调 badge 内部 padding、段间无空格、去掉 `·` 分隔符。期间 leader 一度误判为 scope 蔓延做了回退，确认系用户本意后恢复。
4. **信息回转（steer relay）**（`e170f69`、`3cbf92d`）：用户指出关键缺陷——在 worker 窗口直接 steer 的信息不回传 leader，导致两端信息不对齐（正是上一项误判的根因）。派 K3 agent（steer-relay）实现：worker 监听 pi 的 `on("input")` 事件（`source === "interactive"`），把用户 steer 原文以 `kind: "steer"` 消息回转 parent；lead 广播用 `kind: "lead"` 区分；协议新增 `SwarmMessage.kind` 字段。E2E 验证又发现设计缺陷：steer 消息最初作为 control 消息只弹 UI toast，不进 leader 模型上下文，leader agent 依旧无法对齐；改为走 receiveMessage 作为 followUp 进入 leader 上下文（不 triggerTurn）。最终 E2E 通过：用户在 worker 窗口 steer 后，leader agent 在对话中自动看到「Pi Agent Swarm: user steered <worker>: <原文>」。

## 附：时间线速览

| 时间 | 事件 |
| --- | --- |
| 需求期 | 否定 subagent / RPC / MCP 三条路线，确立「实体终端窗口」第一性原理 |
| 调研期 | 读三个同名 pi-agent-swarm 项目源码，选定 narumiruna 方案 |
| 2026-10-05 | fork 至 `~/code/pi-agent-swarm`（基线 `4c6b1fb`），完成三步改装 + model 参数，提交 `9b507d8` |
| 2026-10-05 | 110 单测全过，E2E 与两轮多 worker 实战验证通过 |
| 2026-10-05 | 双 reviewer 审查报约 16 个 bug（HIGH/MEDIUM/LOW + 上游问题 + 测试盲区） |
| 2026-10-05 | 派出修复 worker 处理 HIGH/MEDIUM；史官 worker 撰写本文档 |
| 2026-10-05 | fixer 完成 6 个 bug 修复，验证全绿，提交 `5faab76` |
| 2026-10-05 | footer 迭代：显示 name+id（`abcc974`）、reload 恢复 name/color（`a497149`）、badge 样式（`71c4963`、`fbaccdd`） |
| 2026-10-05 | 信息回转：worker 用户 steer 回转 leader 并进其模型上下文（`e170f69`、`3cbf92d`），E2E 验证通过 |

## 9. 独立重构与发布（2026-10-05 晚）

在信息回转与 footer 迭代完成后，用户决定将本 fork 彻底独立为新产品：

1. **抛掉复用器后端**：删除 tmux / zellij / ghostty 三个后端及其 smoke 测试、`defaultTerminal` 设置、`session_spawn` 的 `terminal` 覆盖参数。external（真实终端窗口）成为唯一后端，配置面收敛为 `externalCommand`、`confirmSessionLaunch`、`pinToLeadWorkspace` 三项。commit `c579d177`。
2. **改名 pi-agent-swarm**：目录 `packages/pi-fleet` → `packages/pi-agent-swarm`，包名 `@narumitw/pi-fleet` → `pi-agent-swarm`，命令 `/fleet` → `/swarm`，settings 文件 `pi-fleet.json` → `pi-agent-swarm.json`，邀请前缀 `pifleet:v1` → `piagentswarm:v1`，协议常量 `FLEET_*` → `SWARM_*`。runtime 目录缩短为 `pi-swarm` 以留在 Unix socket 103 字节路径预算内。commit `33b5a54f`。
3. **npm 抢注与发布**：以 `xihuang_hk` 身份抢注裸名 `pi-agent-swarm@0.0.0` 占位，随后以 `0.1.0` 作为首个正式版本发布（含构建产物 dist）。
4. **README 多语言**：根 README 拆分为 9 种语言的独立文件（English / 简体中文 / Español / Français / Deutsch / 日本語 / 한국어 / Português / Русский），每个文件顶部放语言切换栏，全文翻译并补上 npm 安装方式。

GitHub 仓库：`fishing-dev-sm/pi-agent-swarm`，npm 包：`pi-agent-swarm`。

## 10. 环境配置修复（2026-10-05 深夜）

改名后新开 pi 未显示 LEADER badge、`/lead` 命令失效（报 "Operation aborted"）。排查后确认是**环境配置残留**，非代码缺陷：

- 根因：pi 的扩展安装记录存于用户配置 `~/.pi/agent/settings.json` 的 `packages` 列表，改名后仍指向旧路径 `../../code/pi-fleet/packages/pi-fleet`（该目录已被 `git mv` 删除），导致新会话静默加载失败——无 `/lead` 命令、无 `session_start` hook，`/lead 测试` 被当作普通消息发给模型。
- 修复两处：① `settings.json` 的 `packages[3]` 改为 `../../code/pi-fleet/packages/pi-agent-swarm`；② settings 文件 `pi-fleet.json` 改名 `pi-agent-swarm.json` 并删除已废弃的 `defaultTerminal` 字段（保留 externalCommand / confirmSessionLaunch / pinToLeadWorkspace 三项）。
- 验证：用修复后的 packages 配置跑 smoke，session 文件自动生成 `"name":"MANAGER-<sessionId前8位>"`，确认扩展加载 + session_start hook + 自动命名 + defaultLead 逻辑正常。

教训：**目录改名除仓库外，还需同步检查用户级 `~/.pi/agent` 的安装指向**（settings.json 的 packages 列表、settings 文件本身），这些不在 git 跟踪内，git 检查无法发现。
