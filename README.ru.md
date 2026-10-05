# 🪟 Pi Fleet WM

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev)

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.pt.md">Português</a> |
  <a href="README.ru.md"><strong>Русский</strong></a>
</p>

Форк [`pi-fleet`](./packages/pi-fleet), переработанный под оконный менеджер для [Pi Coding Agent](https://pi.dev).
Вместо tmux или фоновых подпроцессов каждый агент — это **настоящее окно терминала** с полноценным Pi TUI, размещаемое любым тайловым оконным менеджером.

![Pi Fleet WM в работе](docs/images/pi-fleet-wm.png)

## Введение

pi-fleet-wm перерабатывает pi-fleet вокруг тайлового оконного менеджера.
Каждый агент работает как настоящее окно терминала с полноценным Pi TUI — а не как фоновый подпроцесс.
Новые окна закрепляются на рабочем пространстве сессии-лидера, а бейдж в подвале каждого окна
(● имя · sessionId · LEADER / WORKER) позволяет с первого взгляда отличить лидера от воркеров.

## Отличия от апстримного pi-fleet

- **Настоящие окна, без мультиплексора** — бэкенд `external` открывает обычное окно терминала, которое ваш тайловый менеджер раскладывает плиткой; tmux, Zellij и Ghostty не нужны.
- **`pinToLeadWorkspace`** — новые внешние окна попадают на рабочее пространство сессии-лидера, а не на сфокусированное. Рабочее пространство лидера определяется обходом дерева процессов до `_NET_WM_PID` терминала, затем окно перемещается оконным менеджером; размещение — best-effort и никогда не блокирует запуск.
- **Роли лидер / воркер** — бейджи в подвале показывают `LEADER` / `WORKER` с цветами для каждой сессии; `/lead`, `/color`.
- **Ретрансляция управления (steer relay)** — текст, введённый в окно воркера, ретранслируется в контекст модели лидера.
- **`session_bus shutdown`** — лидер может корректно завершить окно воркера.
- Сессии, запущенные человеком, по умолчанию именуются `MANAGER-<id>` и автоматически становятся лидером.

Полную историю изменений см. в [`docs/pi-fleet-project-history.md`](docs/pi-fleet-project-history.md), а полную справку по расширению — в [`packages/pi-fleet/README.md`](packages/pi-fleet/README.md).

## 🚀 Быстрый старт

Соберите и загрузите расширение из этой рабочей копии:

```bash
npm install
npm --workspace @narumitw/pi-fleet run build
pi --no-extensions -e ./packages/pi-fleet
```

Или установите его как локальный пакет:

```bash
pi install ./packages/pi-fleet
```

Запуск с внешним бэкендом:

```json
{
  "defaultTerminal": "external",
  "externalCommand": "alacritty -e",
  "confirmSessionLaunch": false,
  "pinToLeadWorkspace": true
}
```

Стандартная команда `externalCommand` — `alacritty -e`; используйте любую удобную команду терминала.

Используйте `/fleet`, `session_spawn` и `session_bus`, чтобы запускать, направлять и останавливать флот.

## 🗂️ Структура репозитория

```text
packages/pi-fleet/        Расширение pi-fleet-wm (основная реализация под src/)
docs/                     История проекта, изображения и соглашения репозитория
deprecated/               Пакеты апстрима, исключённые из активных скриптов workspace
packages/                 Полный апстрим-монорепозиторий pi-extensions, сохранённый из форка
```

Этот репозиторий — форк [`narumiruna/pi-extensions`](https://github.com/narumiruna/pi-extensions).
Все пакеты расширений апстрима остаются под `packages/` и сохраняют собственные README и лицензии.

## 📄 Лицензия

MIT. См. [`LICENSE`](./LICENSE).
