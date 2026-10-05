# 🪟 Pi Fleet WM

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev)

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.ja.md"><strong>日本語</strong></a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.pt.md">Português</a> |
  <a href="README.ru.md">Русский</a>
</p>

[Pi Coding Agent](https://pi.dev) 向け [`pi-fleet`](./packages/pi-fleet) のウィンドウマネージャネイティブなフォークです。
tmux やヘッドレスな子プロセスの代わりに、各エージェントは完全な Pi TUI を実行する**実体のターミナルウィンドウ**であり、**i3 ウィンドウマネージャ**によってタイル配置されます。

![Pi Fleet WM を i3 上で実行](docs/images/pi-fleet-wm.png)

## はじめに

pi-fleet-wm は、pi-fleet をタイル型ウィンドウマネージャ i3 中心に作り直します。
各エージェントは完全な Pi TUI を備えた実体のターミナルウィンドウ（`alacritty -e`）として動作し、ヘッドレスな子プロセスにはなりません。
新しく生成されたウィンドウはリーダーセッションの i3 ワークスペースに配置され、各ウィンドウのフッターバッジ
（● 名前 · sessionId · LEADER / WORKER）でリーダーとワーカーを一目で区別できます。

## アップストリームの pi-fleet との違い

- **実体のウィンドウ、マルチプレクサ不要** — `external` バックエンドが通常のターミナルウィンドウ（`alacritty -e`）を開き、i3 がタイル配置します。tmux、Zellij、Ghostty は不要です。
- **`pinToLeadWorkspace`** — 新しい外部ウィンドウは、フォーカス中のワークスペースではなくリーダーセッションの i3 ワークスペースに配置されます。リーダーのワークスペースは、プロセスツリーを辿ってターミナルの `_NET_WM_PID` を特定して見つけ、`i3-msg` で移動します。配置はベストエフォートで、起動を妨げることはありません。
- **リーダー / ワーカーの役割** — フッターバッジがセッションごとの色付きで `LEADER` / `WORKER` を表示します。`/lead`、`/color`。
- **ステアリレー** — ワーカーウィンドウに入力したテキストが、リーダーのモデルコンテキストへリレーされます。
- **`session_bus shutdown`** — リーダーがワーカーウィンドウをグレースフルに終了できます。
- 人が起動したセッションはデフォルトで `MANAGER-<id>` と名付けられ、自動的にリーダーになります。

変更履歴の全容は [`docs/pi-fleet-project-history.md`](docs/pi-fleet-project-history.md) を、拡張機能の完全なリファレンスは [`packages/pi-fleet/README.md`](packages/pi-fleet/README.md) を参照してください。

## 🚀 クイックスタート

このチェックアウトから拡張機能をビルドして読み込みます:

```bash
npm install
npm --workspace @narumitw/pi-fleet run build
pi --no-extensions -e ./packages/pi-fleet
```

またはローカルパッケージとしてインストールします:

```bash
pi install ./packages/pi-fleet
```

external バックエンドで i3 上で実行します:

```json
{
  "defaultTerminal": "external",
  "externalCommand": "alacritty -e",
  "confirmSessionLaunch": false,
  "pinToLeadWorkspace": true
}
```

`/fleet`、`session_spawn`、`session_bus` でフリートを起動・操作・シャットダウンします。

## 🗂️ リポジトリ構成

```text
packages/pi-fleet/        pi-fleet-wm 拡張機能（正式な実装は src/ 配下）
docs/                     プロジェクト履歴、画像、リポジトリの規約
deprecated/               アクティブなワークスペーススクリプトから除外されたアップストリームのパッケージ
packages/                 フォークから引き継いだ完全なアップストリーム pi-extensions モノレポ
```

このリポジトリは [`narumiruna/pi-extensions`](https://github.com/narumiruna/pi-extensions) のフォークです。
アップストリームのすべての拡張パッケージは `packages/` 配下に残り、それぞれの README とライセンスを保持します。

## 📄 ライセンス

MIT。[`LICENSE`](./LICENSE) を参照。
