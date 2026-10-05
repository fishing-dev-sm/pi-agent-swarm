# 🪟 Pi Fleet WM

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev)

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md"><strong>Français</strong></a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.pt.md">Português</a> |
  <a href="README.ru.md">Русский</a>
</p>

Un fork de [`pi-fleet`](./packages/pi-fleet) pensé pour le gestionnaire de fenêtres, destiné au [Pi Coding Agent](https://pi.dev).
Au lieu de tmux ou de sous-processus sans interface, chaque agent est une **véritable fenêtre de terminal** exécutant une TUI Pi complète, agencée en mosaïque par le **gestionnaire de fenêtres i3**.

![Pi Fleet WM sous i3](docs/images/pi-fleet-wm.png)

## Introduction

pi-fleet-wm repense pi-fleet autour du gestionnaire de fenêtres i3.
Chaque agent s'exécute dans une vraie fenêtre de terminal (`alacritty -e`) avec une TUI Pi complète — jamais comme un sous-processus sans interface.
Les nouvelles fenêtres sont épinglées à l'espace de travail i3 de la session leader, et chaque fenêtre affiche un badge en pied
(● nom · sessionId · LEADER / WORKER) pour distinguer le leader des travailleurs d'un coup d'œil.

## Différences avec le pi-fleet d'upstream

- **Vraies fenêtres, sans multiplexeur** — le backend `external` ouvre une fenêtre de terminal ordinaire (`alacritty -e`) agencée par i3 ; aucun besoin de tmux, Zellij ou Ghostty.
- **`pinToLeadWorkspace`** — les nouvelles fenêtres externes arrivent sur l'espace de travail i3 de la session leader plutôt que sur l'espace focalisé. L'espace de travail leader est localisé en remontant l'arbre des processus jusqu'au `_NET_WM_PID` du terminal, puis déplacé avec `i3-msg` ; le placement est au mieux et ne bloque jamais le lancement.
- **Rôles leader / travailleur** — les badges de pied affichent `LEADER` / `WORKER` avec des couleurs par session ; `/lead`, `/color`.
- **Relais de guidage (steer relay)** — le texte saisi dans une fenêtre travailleuse est relayé dans le contexte du modèle du leader.
- **`session_bus shutdown`** — le leader peut fermer proprement une fenêtre travailleuse.
- Les sessions lancées par un humain sont nommées `MANAGER-<id>` par défaut et s'autoproclament leader automatiquement.

Voir [`docs/pi-fleet-project-history.md`](docs/pi-fleet-project-history.md) pour l'historique complet et [`packages/pi-fleet/README.md`](packages/pi-fleet/README.md) pour la référence complète de l'extension.

## 🚀 Démarrage rapide

Compilez et chargez l'extension depuis ce checkout :

```bash
npm install
npm --workspace @narumitw/pi-fleet run build
pi --no-extensions -e ./packages/pi-fleet
```

Ou installez-la comme paquet local :

```bash
pi install ./packages/pi-fleet
```

Exécutez sous i3 avec le backend externe :

```json
{
  "defaultTerminal": "external",
  "externalCommand": "alacritty -e",
  "confirmSessionLaunch": false,
  "pinToLeadWorkspace": true
}
```

Utilisez `/fleet`, `session_spawn` et `session_bus` pour lancer, diriger et éteindre la flotte.

## 🗂️ Structure du dépôt

```text
packages/pi-fleet/        L'extension pi-fleet-wm (implémentation de référence sous src/)
docs/                     Historique du projet, images et conventions du dépôt
deprecated/               Paquets upstream exclus des scripts actifs du workspace
packages/                 Le monorepo upstream pi-extensions complet, conservé depuis le fork
```

Ce dépôt est un fork de [`narumiruna/pi-extensions`](https://github.com/narumiruna/pi-extensions).
Tous les paquets d'extension upstream restent sous `packages/` et conservent leurs propres README et licences.

## 📄 Licence

MIT. Voir [`LICENSE`](./LICENSE).
