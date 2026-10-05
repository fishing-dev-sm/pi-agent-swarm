# 🪟 Pi Fleet WM

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev)

A window-manager-native fork of [`pi-fleet`](./packages/pi-fleet) for the [Pi Coding Agent](https://pi.dev).
Instead of tmux or headless subprocesses, every agent is a **real terminal window** running a full Pi TUI, tiled by the **i3 window manager**.

![Pi Fleet WM running under i3](docs/images/pi-fleet-wm.png)

## Introduction

pi-fleet-wm reworks pi-fleet around the i3 tiling window manager.
Each agent runs as a real terminal window (`alacritty -e`) with a complete Pi TUI — never a headless child process.
Newly spawned windows are pinned to the lead session's i3 workspace, and every window shows a footer badge
(● name · sessionId · LEADER / WORKER) so you can tell the leader from the workers at a glance.

## 简介

pi-fleet-wm 是 [pi-fleet](./packages/pi-fleet) 的窗口管理器原生分支，围绕 i3 平铺窗口管理器重新设计。
每个 agent 都是一个由 i3 平铺管理的**真实终端窗口**（`alacritty -e`），运行完整的 Pi TUI，绝不是无头子进程。
新生成的窗口会自动落到 lead 会话所在的 i3 工作区，每个窗口底部都有徽章（● 名称 · sessionId · LEADER / WORKER），一眼就能分清 leader 和 worker。

## Other languages

**Español** — pi-fleet-wm rediseña pi-fleet en torno al gestor de ventanas en mosaico i3.
Cada agente se ejecuta como una ventana de terminal real (`alacritty -e`) con una TUI de Pi completa — nunca como un subproceso sin interfaz.
Las ventanas nuevas se fijan al espacio de trabajo i3 de la sesión líder, y cada ventana muestra una insignia (● nombre · sessionId · LEADER / WORKER) para distinguir al líder de los trabajadores de un vistazo.

**Français** — pi-fleet-wm repense pi-fleet autour du gestionnaire de fenêtres i3.
Chaque agent s'exécute dans une vraie fenêtre de terminal (`alacritty -e`) avec un TUI Pi complet — jamais comme sous-processus sans interface.
Les nouvelles fenêtres sont épinglées à l'espace de travail i3 de la session leader, et chaque fenêtre affiche un badge (● nom · sessionId · LEADER / WORKER) pour distinguer le leader des travailleurs d'un coup d'œil.

**Deutsch** — pi-fleet-wm baut pi-fleet rund um den kachelnden Fenstermanager i3 neu auf.
Jeder Agent läuft als echtes Terminalfenster (`alacritty -e`) mit einer vollständigen Pi-TUI — nie als headless Kindprozess.
Neue Fenster werden auf den i3-Arbeitsbereich der Leader-Sitzung verschoben, und jedes Fenster zeigt ein Badge (● Name · sessionId · LEADER / WORKER), um Leader und Worker auf einen Blick zu unterscheiden.

**日本語** — pi-fleet-wm は、pi-fleet をタイル型ウィンドウマネージャ i3 中心に作り直したフォークです。
各エージェントは完全な Pi TUI を備えた実体のターミナルウィンドウ（`alacritty -e`）として動作し、ヘッドレスな子プロセスにはなりません。
新しいウィンドウはリーダーセッションの i3 ワークスペースに配置され、各ウィンドウのバッジ（● 名前 · sessionId · LEADER / WORKER）でリーダーとワーカーを一目で区別できます。

**한국어** — pi-fleet-wm은 pi-fleet을 타일링 창 관리자 i3 중심으로 다시 만든 포크입니다.
각 에이전트는 완전한 Pi TUI를 갖춘 실제 터미널 창(`alacritty -e`)으로 실행되며, 헤드리스 하위 프로세스가 아닙니다.
새 창은 리더 세션의 i3 워크스페이스에 배치되고, 각 창의 배지(● 이름 · sessionId · LEADER / WORKER)로 리더와 워커를 한눈에 구분할 수 있습니다.

**Português** — pi-fleet-wm reconstrói o pi-fleet em torno do gerenciador de janelas i3.
Cada agente roda como uma janela de terminal real (`alacritty -e`) com uma TUI do Pi completa — nunca como um subprocesso sem interface.
Novas janelas são fixadas no espaço de trabalho i3 da sessão líder, e cada janela mostra um selo (● nome · sessionId · LEADER / WORKER) para distinguir o líder dos trabalhadores de relance.

**Русский** — pi-fleet-wm перерабатывает pi-fleet вокруг тайлового оконного менеджера i3.
Каждый агент работает как настоящее окно терминала (`alacritty -e`) с полноценным Pi TUI — а не как фоновый подпроцесс.
Новые окна закрепляются на рабочем пространстве i3 сессии-лидера, а бейдж в каждом окне (● имя · sessionId · LEADER / WORKER) позволяет с первого взгляда отличить лидера от воркеров.

## What's different from upstream pi-fleet

- **Real windows, no multiplexer** — an `external` backend spawns a plain terminal window (`alacritty -e`) that i3 tiles; no tmux, Zellij, or Ghostty needed.
- **`pinToLeadWorkspace`** — new external windows land on the lead session's i3 workspace instead of the focused one. The lead workspace is located by walking the process tree to the terminal's `_NET_WM_PID`, then moved with `i3-msg`; placement is best-effort and never blocks launch.
- **Lead / worker roles** — footer badges show `LEADER` / `WORKER` with per-session colors; `/lead`, `/color`.
- **Steer relay** — text you type into a worker window is relayed into the leader's model context.
- **`session_bus shutdown`** — the leader can gracefully tear down a worker window.
- Human-started sessions default to `MANAGER-<id>` and self-lead automatically.

See [`docs/pi-fleet-project-history.md`](docs/pi-fleet-project-history.md) for the full change history and [`packages/pi-fleet/README.md`](packages/pi-fleet/README.md) for the complete extension reference.

## 🚀 Quick start

Build and load the extension from this checkout:

```bash
npm install
npm --workspace @narumitw/pi-fleet run build
pi --no-extensions -e ./packages/pi-fleet
```

Or install it as a local package:

```bash
pi install ./packages/pi-fleet
```

Run under i3 with the external backend:

```json
{
  "defaultTerminal": "external",
  "externalCommand": "alacritty -e",
  "confirmSessionLaunch": false,
  "pinToLeadWorkspace": true
}
```

Use `/fleet`, `session_spawn`, and `session_bus` to launch, steer, and shut down the fleet.

## 🗂️ Repository layout

```text
packages/pi-fleet/        The pi-fleet-wm extension (authoritative implementation under src/)
docs/                     Project history, images, and repository conventions
deprecated/               Upstream packages excluded from active workspace scripts
packages/                 The full upstream pi-extensions monorepo, preserved from the fork
```

This repository is a fork of [`narumiruna/pi-extensions`](https://github.com/narumiruna/pi-extensions).
All upstream extension packages remain under `packages/` and keep their own READMEs and licenses.

## 📄 License

MIT. See [`LICENSE`](./LICENSE).
