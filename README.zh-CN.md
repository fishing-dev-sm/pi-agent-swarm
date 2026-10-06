# 🪟 Pi Agent Swarm

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev)

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md"><strong>简体中文</strong></a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.pt.md">Português</a> |
  <a href="README.ru.md">Русский</a>
</p>

[`pi-fleet`](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-fleet) 的窗口管理器原生分支，面向 [Pi Coding Agent](https://pi.dev)。
不用 tmux，也不用无头子进程：每个 agent 都是一个由任意平铺窗口管理器平铺的**真实终端窗口**，运行完整的 Pi TUI。

![Pi Agent Swarm 运行截图](docs/images/pi-agent-swarm.png)

## 简介

pi-agent-swarm 围绕平铺窗口管理器重新设计 pi-fleet。
每个 agent 都是一个真实终端窗口，运行完整的 Pi TUI——绝不是无头子进程。
新生成的窗口会自动钉到 lead 会话所在的工作区，每个窗口底部都有徽章
（● 名称 · sessionId · LEADER / WORKER），一眼就能分清 leader 和 worker。

## 与上游 pi-fleet 的不同

- **真实窗口，无复用器** —— `external` 后端生成一个普通终端窗口，交给你的平铺窗口管理器平铺；不需要 tmux、Zellij 或 Ghostty。
- **`pinToLeadWorkspace`** —— 新外部窗口落到 lead 会话的工作区，而不是当前聚焦的工作区。通过沿进程树找到终端的 `_NET_WM_PID` 来定位 lead 工作区，再由窗口管理器移动；放置尽力而为，绝不阻塞启动。
- **lead / worker 角色** —— footer 徽章显示 `LEADER` / `WORKER`，每会话独立配色；`/lead`、`/color`。
- **信息回转（steer relay）** —— 你在 worker 窗口输入的文字会回转进 leader 的模型上下文。
- **`session_bus shutdown`** —— leader 可以优雅关闭一个 worker 窗口。
- 人工启动的会话默认命名为 `MANAGER-<id>`，并自动成为 lead。

完整的变更历史见 [`docs/pi-agent-swarm-project-history.md`](docs/pi-agent-swarm-project-history.md)，完整的扩展参考见 [`packages/pi-agent-swarm/README.md`](packages/pi-agent-swarm/README.md)。

## 🚀 快速开始

从 npm 安装：

```bash
pi install pi-agent-swarm
```

或从本仓库构建并加载：

```bash
npm install
npm --workspace pi-agent-swarm run build
pi --no-extensions -e ./packages/pi-agent-swarm
```

或作为本地包安装：

```bash
pi install ./packages/pi-agent-swarm
```

用 external 后端运行：

```json
{
  "externalCommand": "alacritty -e",
  "confirmSessionLaunch": false,
  "pinToLeadWorkspace": true
}
```

默认的 `externalCommand` 是 `alacritty -e`；可以换成任意终端命令。

用 `/swarm`、`session_spawn` 和 `session_bus` 来启动、指挥和关闭舰队。

## 🗂️ 仓库结构

```text
packages/pi-agent-swarm/        pi-agent-swarm 扩展（权威实现位于 src/ 下）
docs/                     项目历史、图片与仓库规范
```

## 🙏 鸣谢

本项目最初 fork 自 [`narumiruna/pi-extensions`](https://github.com/narumiruna/pi-extensions)
（具体为其 `pi-fleet` 包）。感谢上游作者的原始实现与设计。上游版权声明已按要求保留在
[`LICENSE`](./LICENSE) 中。本仓库现已完全独立，不再跟踪上游。

## 📄 许可证

MIT。见 [`LICENSE`](./LICENSE)。
