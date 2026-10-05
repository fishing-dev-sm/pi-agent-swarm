# 🪟 Pi Agent Swarm

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev)

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.es.md"><strong>Español</strong></a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.pt.md">Português</a> |
  <a href="README.ru.md">Русский</a>
</p>

Un fork de [`pi-fleet`](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-fleet) nativo del gestor de ventanas para el [Pi Coding Agent](https://pi.dev).
En lugar de tmux o subprocesos sin interfaz, cada agente es una **ventana de terminal real** que ejecuta una TUI de Pi completa, organizada en mosaico por cualquier gestor de ventanas en mosaico.

![Pi Agent Swarm en ejecución](docs/images/pi-agent-swarm.png)

## Introducción

pi-agent-swarm rediseña pi-fleet en torno a un gestor de ventanas en mosaico.
Cada agente se ejecuta como una ventana de terminal real con una TUI de Pi completa — nunca como un subproceso sin interfaz.
Las ventanas recién generadas se fijan al espacio de trabajo de la sesión líder, y cada ventana muestra una insignia en el pie
(● nombre · sessionId · LEADER / WORKER) para distinguir al líder de los trabajadores de un vistazo.

## Diferencias con el pi-fleet de upstream

- **Ventanas reales, sin multiplexor** — el backend `external` abre una ventana de terminal normal que tu gestor de ventanas organiza en mosaico; no se necesita tmux, Zellij ni Ghostty.
- **`pinToLeadWorkspace`** — las nuevas ventanas externas caen en el espacio de trabajo de la sesión líder en lugar del espacio enfocado. El espacio de trabajo líder se localiza recorriendo el árbol de procesos hasta el `_NET_WM_PID` del terminal y luego se mueve con el gestor de ventanas; la colocación es de mejor esfuerzo y nunca bloquea el lanzamiento.
- **Roles líder / trabajador** — las insignias del pie muestran `LEADER` / `WORKER` con colores por sesión; `/lead`, `/color`.
- **Retransmisión de dirección (steer relay)** — el texto que escribes en una ventana trabajadora se retransmite al contexto del modelo del líder.
- **`session_bus shutdown`** — el líder puede cerrar una ventana trabajadora de forma ordenada.
- Las sesiones iniciadas por humanos se nombran `MANAGER-<id>` por defecto y se autodesignan líder automáticamente.

Consulta [`docs/pi-agent-swarm-project-history.md`](docs/pi-agent-swarm-project-history.md) para el historial completo de cambios y [`packages/pi-agent-swarm/README.md`](packages/pi-agent-swarm/README.md) para la referencia completa de la extensión.

## 🚀 Inicio rápido

Instala desde npm:

```bash
pi install pi-agent-swarm
```

O compila y carga la extensión desde este checkout:

```bash
npm install
npm --workspace pi-agent-swarm run build
pi --no-extensions -e ./packages/pi-agent-swarm
```

O instálala como un paquete local:

```bash
pi install ./packages/pi-agent-swarm
```

Ejecútala con el backend externo:

```json
{
  "externalCommand": "alacritty -e",
  "confirmSessionLaunch": false,
  "pinToLeadWorkspace": true
}
```

El `externalCommand` predeterminado es `alacritty -e`; usa el comando de terminal que prefieras.

Usa `/swarm`, `session_spawn` y `session_bus` para lanzar, dirigir y apagar la flota.

## 🗂️ Estructura del repositorio

```text
packages/pi-agent-swarm/        La extensión pi-agent-swarm (implementación autoritativa bajo src/)
docs/                     Historial del proyecto, imágenes y convenciones del repositorio
deprecated/               Paquetes de upstream excluidos de los scripts activos del workspace
packages/                 El monorepo upstream pi-extensions completo, conservado del fork
```

Este repositorio es un fork de [`narumiruna/pi-extensions`](https://github.com/narumiruna/pi-extensions).
Todos los paquetes de extensión de upstream permanecen bajo `packages/` y conservan sus propios README y licencias.

## 📄 Licencia

MIT. Consulta [`LICENSE`](./LICENSE).
