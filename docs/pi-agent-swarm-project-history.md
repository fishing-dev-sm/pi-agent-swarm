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

## 11. `/swarm` 菜单重建（2026-10-06）

独立重构后，`/swarm` 菜单仍完整继承自 `/fleet` 时代，菜单里一堆旧项（邀请加入、lead 管理、peer 列表等）对当前「实体终端窗口」形态已无意义。用户决策：**彻底移除旧菜单，逐项重建**，重建顺序为 Spawn → Rename → Set color。

### 11.1 移除旧菜单

- 删除 `src/menu.ts` 与 `test/menu.test.ts`，清理 `src/pi-agent-swarm.ts` 的菜单集成（loadMenu / menuSource / cachedModuleLoader）、`@narumitw/pi-tui-kit` 依赖与 README 菜单引用。
- 保留 `settings.update()`（settings 组件核心能力，重建时会用到）。

### 11.2 重建 Spawn（第一项）

- 恢复 `@narumitw/pi-tui-kit@^0.59.0` 依赖；重写 `src/menu.ts`（`Screen="main"`、`Action="spawn"`、`createSwarmMenu`、`showSwarmMenu`）。
- `src/pi-agent-swarm.ts` 恢复 `loadMenu`（懒加载 + 缓存 + 失败重置）与 `menuSource(controller)`。
- 验证：typecheck ✓、19 文件 / 79 测试 ✓、biome ✓、build（menu 懒加载 chunk）✓。

### 11.3 修复 Spawn「一直 Launching」卡死

- 根因：Spawn 项声明的 `busyLabel: "Launching"` 在 TUI 模式走 `invokeBusyAction → runTask → TaskLoader`（阻塞式加载器），而 spawn action 内部又嵌套 `ctx.ui.select`（方向）/ `ctx.ui.input`（任务）/ `ctx.ui.confirm`（确认），与 TaskLoader 冲突死锁。
- 修复：移除 Spawn 项的 `busyLabel`，耗时反馈改由 controller 内部 `beginStatus/updateStatus`（`swarm: launching …` → `swarm: waiting for child session`）承担。
- 防回归：`test/menu.test.ts` 断言 spawn item 无 `busyLabel`。
- 教训：`busyLabel` 只适用于纯异步 action；任何 action 内部弹 modal（select/input/confirm）都不能加 busyLabel，否则 TUI 死锁。

### 11.4 加 Rename 与 Set color（第二、三项）

**名字/颜色传播模型**：peer 描述字段（name/color/cwd/acceptsRequests）不在 endpoint manifest 里，而是按需传播——discovery 发 `{ kind: "describe" }`，每个 peer 从内存实时回 `{ kind: "description", peer }`。因此 rename/setColor 只需改本地 `this.peer` + 持久化到 Pi，无需显式广播。

**Rename**：

- `transport.setName(name)` 改 peer description 的 name。
- `controller.setOwnName(ctx, name, signal?)`：`normalizeOptionalText`（空报错）→ `pi.setSessionName` → `transport.setName` → `renderFooterStatus`。
- 菜单 action 弹 `ctx.ui.input`（空/取消不生效）；成功后 footer badge 名字立即刷新，其他 peer 下次 discover 读到新名字。

**Set color**：

- 复用 `/color` 的 `controller.setOwnColor`（加可选 `signal` 参数，与 setLead 对齐）。
- 菜单 action 弹 `ctx.ui.select` 从 8 色调色板（red/orange/yellow/green/cyan/blue/magenta/purple）选，底层 `normalizeSwarmColor` 转 hex；自定义 hex 仍走 `/color` 命令。

验证：typecheck ✓、19 文件 / 83 测试 ✓、biome ✓、build（dist 含新代码）✓。

## 12. LEADER reload 后全组变 WORKER（2026-10-06）

用户报告：leader 会话（01a10fcb）指派 spawn worker 后，自己的 footer badge 从 LEADER 变成 WORKER。磁盘证据：活跃组目录 `pi-swarm/879cac…/` 无 `lead.json`，而 leader 的 endpoint manifest `publishedAt`（19:32:08）晚于组建时间（14:07），证明其间发生过一次 reload。

**根因**：`sessionShutdown(reason="reload")` → `cleanupActive(true)` → `leaveGroupInternal()` 按「lead 离组」逻辑删除 `lead.json`；但 reload handoff（`putReloadHandoff`/`takeReloadHandoff`）只保存 invite/name/color 等成员身份，不保存 lead 身份。同进程秒级重进组后 lead 记录已永久丢失，全组（含 lead 自己）显示 WORKER。`cleanupActive(_reloading)` 参数本就存在却被忽略——原作者留了钩子没接上。spawn 本身不触碰 lead.json，「指派 spawn 后才变 WORKER」是时间巧合（worker 改扩展文件触发了 leader 的热重载）。

**修复**：把 `reloading` 从 `cleanupActive` 传入 `leaveGroupInternal`，reload 导致的离组跳过 `lead.json` 删除（`swarm-controller.ts` :914/:930/:945）。重进组后 `primeFooter → refreshLead` 读到保留的记录立即恢复 LEADER。真正的离开（quit、`/leave`、会话替换、spawn 回滚）保持删除语义。设计取舍：只跳过删除、**不**在 handoff 里存 wasLead 重新断言——reload 间隙若他人合法 `/lead`，旧 lead 回来读到新记录显示 WORKER 是正确行为，盲目重新断言会覆盖新 lead。会话若 reload 后再不回来，陈旧 lead.json 与进程崩溃场景一致，现有设计本已容忍（"the next lead overwrites it anyway"）。

**测试**（先枚举 7 种失败方式 → 写测试看红 → 再实现）：`test/swarm-controller.test.ts` 新增 5 个测试，用真实临时目录验证 lead.json 存废——lead reload 存活并恢复 LEADER（修复前红）、quit/`leave()` 仍删除、会话替换仍删除、成员 reload 不动他人 lead 记录、lead.json 已缺失时 reload 不重建不崩溃（不追溯修复）。FakeTransport 的 `endpointManifest.directory` 参数化以支持真实目录。

**顺带修复（HEAD 既有失败，独立意图）**：`npm test` 的 `tsc -p tsconfig.test.json` 在干净 HEAD 上就报 `createTmux` TS2353（仓库外 worktree 实证）——第 9 节删除 tmux/zellij/ghostty 后端时，`SwarmControllerDependencies` 接口删了三个工厂，但 swarm-controller.test.ts 的 `dependencies()` 工厂里 3 个死 mock 未清理。已删除，全仓库 grep 确认失败类只此一处。

**验证**：`npm run check` ✓、`npm test`（479 文件 / 6136 测试）✓、dist 重建含修复 ✓、`pi --no-extensions -e ./packages/pi-agent-swarm -p` 加载 smoke ✓。Changeset：`.changeset/lead-record-survives-reload.md`（patch）。

**部署注意**：已丢失 lead.json 的现存组不追溯修复——leader 会话 `/reload` 加载新代码后需 `/lead <名字|id>` 一次性恢复记录，之后 reload 不再丢 LEADER。

教训：**生命周期清理逻辑要区分「真的离开」与「reload 瞬离」**——凡是 session_shutdown 里的资源释放，都要问一句：这个资源 reload 回来时还需要吗？handoff 恢复的状态集合必须与 shutdown 清理的状态集合对齐审计。

## 13. footer badge 三档缩略模式（2026-10-06）

窄终端下三段 footer badge（name+36 位 id+角色，全长 66 列）会溢出换行。用户要求设计「长度不同情况下的缩略模式」，先出三档设计稿审核（全彩 mjs 预览板），通过后实装。

### 13.1 设计（审核通过）

按「可用宽度 A = floor(终端列数 × 0.55)」分三档：

- **FULL**：name + 全 36 位 id + 角色（A 装得下全时）。
- **COMPACT**：name 超预算按 cell 截断加 `…`（预算 < 8 列则降级），id 取 UUID 前 8 位——与 `MANAGER-<前8位>` 命名、`/lead` 前缀匹配同源，是一等标识符故**不加省略号**。
- **MINIMAL**：色点（3 列）+ 角色（8 列）= 11 列硬底线，A < 20 或 name 预算不足时启用。

存活优先级：**角色 > 身份色 > name > id**（角色永不砍，用户审核时明确拍板）。

### 13.2 实现

- 新增 `src/footer.ts`：纯函数 `buildRosterBadge({ name, sessionId, color, role, columns })`，集中阈值常量（`FOOTER_WIDTH_FRACTION=0.55`、`SHORT_ID_LENGTH=8`、`MIN_NAME_BUDGET=8`、`DEFAULT_TERMINAL_COLUMNS=80`）；宽度计算用 pi-tui 的 `visibleWidth`/`truncateToWidth`（cell 级，不碎 UTF-8/CJK），name/sessionId 先过 `safeTerminalLine` 消毒。
- `src/swarm-controller.ts`：`renderFooterStatus` 改为调用 `buildRosterBadge`；`SwarmControllerDependencies` 新增可选 `terminalColumns()`（默认读 `process.stdout.columns`，非 TTY 回退 80 列）；新增 SIGWINCH resize watcher，镜像 leadWatcher 模式（session_start 挂 / sessionShutdown 摘 / 幂等 / abort 后惰性失效），跨档时自动重渲染。
- `ROLE_BADGE_BACKGROUND="#ffc85a"` 从控制器迁入 footer.ts；README 补 Features bullet、`## 🏷️ Footer badge` 小节与 Package layout 条目；changeset 为 minor。

### 13.3 验证与提交

- 包级 tsc / biome / vitest（88 测试）/ build 全绿；根门禁 `npm run check` + `npm test`（479 文件 / 6136 测试）全绿。
- E2E 产物 `/tmp/fleet-results/footer-modes-e2e.mjs`（对 esbuild 打包的真实 footer.ts 跑宽度扫描）：12 项断言全过——20..200 列扫描宽度有界且角色永存、160→FULL / 60→COMPACT / 30→MINIMAL、长名带 `…` 短 id 不带、控制序列消毒、CJK 截断不碎字符、两角色等宽。
- 提交 **`057badd9`**（`feat(pi-agent-swarm): adapt the footer badge to terminal width in three tiers`）。因工作区混有菜单重建与 lead reload 修复的在飞改动，提交时按 hunk 过滤暂存（swarm-controller.ts 14 取 9、README.md 8 取 3），在飞工作未混入。
- 未验证路径：真实 TTY 拖窗口目视换挡（逻辑已由宽度扫描覆盖）。

## 14. GitHub 语言色调色板与 `/swarm` Set theme（2026-10-06）

用户反馈 roster badge 颜色饱和度过高（Tailwind 500 色系平均饱和度 88%），要求参考 GitHub 各语言颜色体系出颜色稿审核。审核产物 `scripts/color-draft.mjs`（真彩 ANSI 预览板，复刻 FULL 徽章并统计饱和度）。用户定案：低饱和（A）与亮色（B）双方案并存、默认低饱和、设置可切换；ROLE 黄 `#ffc85a` 保留不动；低饱和方案的 yellow 槽与 ROLE 黄同色，不接受亮灰替代。

### 14.1 调色板

- `src/color.ts` 新增 `SWARM_COLOR_PALETTES`：`muted`（默认，低饱和 GitHub Linguist 取色，yellow 槽 = `#ffc85a` 与 ROLE 徽章同色）与 `bright`（GitHub 原色高饱和）。两板槽序一致（red/orange/yellow/green/cyan/blue/magenta/purple），seed 选色跨板保持色相。
- `SWARM_COLORS` 保留为 muted 别名（menu 等消费点不变）；旧 Tailwind hex 收进 `LEGACY_SWARM_COLORS` 仅用于 hex→槽名反查，旧版本指派的颜色在 peer 标签里仍解析为色名。
- `normalizeSwarmColor`/`pickSwarmColor` 增加 palette 参数（默认 muted），三处调用点从设置读当前板。

### 14.2 设置与实时切换

- 新增 `colorPalette: "muted" | "bright"` 设置项（默认 muted，校验拒绝其他值）；手改 `pi-agent-swarm.json` 下次 session start 或 `/reload` 生效。
- `/swarm` 菜单第四项 **Set theme**：`ctx.ui.select` 选板 → `controller.setColorPalette` 持久化设置并把本会话颜色映射到新板同槽（自定义 hex 不动）；只影响自己的 badge，peer 各自本地决定是否跟随。
- `/color` 与菜单 Set color 统一改走 `controller.normalizeColor`，按当前板解析色名。

### 14.3 验证

- 新增 `test/color.test.ts`（两板槽序一致、muted yellow === ROLE 黄、seed 跨板同槽、legacy hex 反查）；settings/controller/menu 测试补齐新字段与 Set theme 用例。包级 tsc/biome/vitest 与根门禁 `npm run check`、`npm test` 全绿；dist 重建 + 加载 smoke ✓。
- 未验证路径：TUI 菜单 Set theme 实际渲染目视（逻辑已由 menu 测试覆盖）。

Changeset：`.changeset/swarm-github-language-palettes.md`（minor）。

## 15. 0.2.0 发布与脱离上游发布流程（2026-10-06）

用户明确：本 fork 已彻底独立，不使用上游的 publish.yml Version PR 流程。发布方式沿用 §9.3 的手动模式：把上游继承的 5 个 `@narumitw/*` changesets 临时移出 `.changeset/` 后运行 `npx changeset version`（只消费本包的 5 个 changesets），随后 `npm publish --workspace pi-agent-swarm`（本机登录身份 `xihuang_hk`）。版本 0.1.0 → 0.2.0（4 minor + 1 patch），CHANGELOG 条目由 changesets 生成。上游 changesets 原样保留，不参与本仓发布。
