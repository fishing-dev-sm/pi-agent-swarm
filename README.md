# 🪟 Pi Agent Swarm

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev)

<p align="center">
  <a href="README.md"><strong>English</strong></a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.pt.md">Português</a> |
  <a href="README.ru.md">Русский</a>
</p>

A window-manager-native fork of [`pi-fleet`](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-fleet) for the [Pi Coding Agent](https://pi.dev).
Instead of tmux or headless subprocesses, every agent is a **real terminal window** running a full Pi TUI, tiled by any tiling window manager.

![Pi Agent Swarm running under a tiling window manager](docs/images/pi-agent-swarm.png)

## Introduction

pi-agent-swarm reworks pi-fleet around a tiling window manager.
Each agent runs as a real terminal window with a complete Pi TUI — never a headless child process.
Newly spawned windows are pinned to the lead session's workspace, and every window shows a footer badge
(● name · sessionId · LEADER / WORKER) so you can tell the leader from the workers at a glance.

## What's different from upstream pi-fleet

- **Real windows, no multiplexer** — an `external` backend spawns a plain terminal window that your tiling window manager tiles; no tmux, Zellij, or Ghostty needed.
- **`pinToLeadWorkspace`** — new external windows land on the lead session's workspace instead of the focused one. The lead workspace is located by walking the process tree to the terminal's `_NET_WM_PID`, then moved with the window manager; placement is best-effort and never blocks launch.
- **Lead / worker roles** — footer badges show `LEADER` / `WORKER` with per-session colors; `/lead`, `/color`.
- **Steer relay** — text you type into a worker window is relayed into the leader's model context.
- **`session_bus shutdown`** — the leader can gracefully tear down a worker window.
- Human-started sessions default to `MANAGER-<id>` and self-lead automatically.

See [`docs/pi-agent-swarm-project-history.md`](docs/pi-agent-swarm-project-history.md) for the full change history and [`packages/pi-agent-swarm/README.md`](packages/pi-agent-swarm/README.md) for the complete extension reference.

## 🚀 Quick start

Install from npm:

```bash
pi install pi-agent-swarm
```

Or build and load it from this checkout:

```bash
npm install
npm --workspace pi-agent-swarm run build
pi --no-extensions -e ./packages/pi-agent-swarm
```

Or install it as a local package:

```bash
pi install ./packages/pi-agent-swarm
```

Run with the external backend:

```json
{
  "externalCommand": "alacritty -e",
  "confirmSessionLaunch": false,
  "pinToLeadWorkspace": true
}
```

The default `externalCommand` is `alacritty -e`; use any terminal command you prefer.

Use `/swarm`, `session_spawn`, and `session_bus` to launch, steer, and shut down the swarm.

## 🗂️ Repository layout

```text
packages/pi-agent-swarm/        The pi-agent-swarm extension (authoritative implementation under src/)
docs/                     Project history, images, and repository conventions
deprecated/               Upstream packages excluded from active workspace scripts
packages/                 The full upstream pi-extensions monorepo, preserved from the fork
```

This repository is a fork of [`narumiruna/pi-extensions`](https://github.com/narumiruna/pi-extensions).
All upstream extension packages remain under `packages/` and keep their own READMEs and licenses.

## 📄 License

MIT. See [`LICENSE`](./LICENSE).
