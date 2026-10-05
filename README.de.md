# 🪟 Pi Fleet WM

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev)

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.de.md"><strong>Deutsch</strong></a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.pt.md">Português</a> |
  <a href="README.ru.md">Русский</a>
</p>

Ein Fenstermanager-nativer Fork von [`pi-fleet`](./packages/pi-fleet) für den [Pi Coding Agent](https://pi.dev).
Statt tmux oder headless Subprozessen ist jeder Agent ein **echtes Terminalfenster**, das eine vollständige Pi-TUI ausführt und vom **Fenstermanager i3** gekachelt wird.

![Pi Fleet WM unter i3](docs/images/pi-fleet-wm.png)

## Einführung

pi-fleet-wm baut pi-fleet rund um den kachelnden Fenstermanager i3 neu auf.
Jeder Agent läuft als echtes Terminalfenster (`alacritty -e`) mit einer vollständigen Pi-TUI — nie als headless Kindprozess.
Neue Fenster werden auf den i3-Arbeitsbereich der Leader-Sitzung verschoben, und jedes Fenster zeigt ein Fußzeilen-Badge
(● Name · sessionId · LEADER / WORKER), um Leader und Worker auf einen Blick zu unterscheiden.

## Unterschiede zum Upstream-pi-fleet

- **Echte Fenster, kein Multiplexer** — das `external`-Backend öffnet ein gewöhnliches Terminalfenster (`alacritty -e`), das i3 kachelt; kein tmux, Zellij oder Ghostty nötig.
- **`pinToLeadWorkspace`** — neue externe Fenster landen auf dem i3-Arbeitsbereich der Leader-Sitzung statt auf dem fokussierten. Der Leader-Arbeitsbereich wird ermittelt, indem der Prozessbaum bis zum `_NET_WM_PID` des Terminals durchlaufen wird, und dann mit `i3-msg` verschoben; die Platzierung ist best-effort und blockiert niemals den Start.
- **Leader-/Worker-Rollen** — Fußzeilen-Badges zeigen `LEADER` / `WORKER` mit Farben pro Sitzung; `/lead`, `/color`.
- **Steuerungsweiterleitung (steer relay)** — Text, den du in ein Worker-Fenster tippst, wird in den Modellkontext des Leaders weitergeleitet.
- **`session_bus shutdown`** — der Leader kann ein Worker-Fenster sauber beenden.
- Von Menschen gestartete Sitzungen heißen standardmäßig `MANAGER-<id>` und ernennen sich automatisch selbst zum Leader.

Siehe [`docs/pi-fleet-project-history.md`](docs/pi-fleet-project-history.md) für die vollständige Änderungshistorie und [`packages/pi-fleet/README.md`](packages/pi-fleet/README.md) für die vollständige Erweiterungsreferenz.

## 🚀 Schnellstart

Erweiterung aus diesem Checkout bauen und laden:

```bash
npm install
npm --workspace @narumitw/pi-fleet run build
pi --no-extensions -e ./packages/pi-fleet
```

Oder als lokales Paket installieren:

```bash
pi install ./packages/pi-fleet
```

Unter i3 mit dem externen Backend ausführen:

```json
{
  "defaultTerminal": "external",
  "externalCommand": "alacritty -e",
  "confirmSessionLaunch": false,
  "pinToLeadWorkspace": true
}
```

Nutze `/fleet`, `session_spawn` und `session_bus`, um die Flotte zu starten, zu steuern und herunterzufahren.

## 🗂️ Repository-Struktur

```text
packages/pi-fleet/        Die pi-fleet-wm-Erweiterung (maßgebliche Implementierung unter src/)
docs/                     Projekthistorie, Bilder und Repository-Konventionen
deprecated/               Upstream-Pakete, die aus den aktiven Workspace-Skripten ausgeschlossen sind
packages/                 Das vollständige Upstream-Monorepo pi-extensions, aus dem Fork erhalten
```

Dieses Repository ist ein Fork von [`narumiruna/pi-extensions`](https://github.com/narumiruna/pi-extensions).
Alle Upstream-Erweiterungspakete bleiben unter `packages/` und behalten ihre eigenen READMEs und Lizenzen.

## 📄 Lizenz

MIT. Siehe [`LICENSE`](./LICENSE).
