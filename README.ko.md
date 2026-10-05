# 🪟 Pi Agent Swarm

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev)

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.ko.md"><strong>한국어</strong></a> |
  <a href="README.pt.md">Português</a> |
  <a href="README.ru.md">Русский</a>
</p>

[Pi Coding Agent](https://pi.dev)용 [`pi-agent-swarm`](./packages/pi-agent-swarm)의 창 관리자 네이티브 포크입니다.
tmux나 헤드리스 하위 프로세스 대신, 각 에이전트는 완전한 Pi TUI를 실행하는 **실제 터미널 창**이며 **임의의 타일링 창 관리자**가 타일로 배치합니다.

![Pi Agent Swarm 실행 화면](docs/images/pi-agent-swarm.png)

## 소개

pi-agent-swarm은 pi-agent-swarm을 타일링 창 관리자 중심으로 다시 만듭니다.
각 에이전트는 완전한 Pi TUI를 갖춘 실제 터미널 창으로 실행되며, 헤드리스 하위 프로세스가 아닙니다.
새로 생성된 창은 리더 세션의 워크스페이스에 배치되고, 각 창의 푸터 배지
(● 이름 · sessionId · LEADER / WORKER)로 리더와 워커를 한눈에 구분할 수 있습니다.

## 업스트림 pi-agent-swarm과의 차이점

- **실제 창, 멀티플렉서 불필요** — `external` 백엔드가 일반 터미널 창을 열고 타일링 창 관리자가 타일로 배치합니다. tmux, Zellij, Ghostty가 필요 없습니다.
- **`pinToLeadWorkspace`** — 새 외부 창은 포커스된 워크스페이스가 아닌 리더 세션의 워크스페이스에 배치됩니다. 리더 워크스페이스는 프로세스 트리를 따라 터미널의 `_NET_WM_PID`를 찾아 위치를 파악한 뒤 창 관리자로 이동합니다. 배치는 최선 노력이며 실행을 막지 않습니다.
- **리더 / 워커 역할** — 푸터 배지가 세션별 색상으로 `LEADER` / `WORKER`를 표시합니다. `/lead`, `/color`.
- **스티어 릴레이** — 워커 창에 입력한 텍스트가 리더의 모델 컨텍스트로 릴레이됩니다.
- **`session_bus shutdown`** — 리더가 워커 창을 정상적으로 종료할 수 있습니다.
- 사람이 시작한 세션은 기본적으로 `MANAGER-<id>`로 명명되고 자동으로 리더가 됩니다.

전체 변경 이력은 [`docs/pi-agent-swarm-project-history.md`](docs/pi-agent-swarm-project-history.md)를, 확장의 전체 레퍼런스는 [`packages/pi-agent-swarm/README.md`](packages/pi-agent-swarm/README.md)를 참조하세요.

## 🚀 빠른 시작

이 체크아웃에서 확장을 빌드하고 로드합니다:

```bash
npm install
npm --workspace pi-agent-swarm run build
pi --no-extensions -e ./packages/pi-agent-swarm
```

또는 로컬 패키지로 설치합니다:

```bash
pi install ./packages/pi-agent-swarm
```

external 백엔드로 실행합니다:

```json
{
  "defaultTerminal": "external",
  "externalCommand": "alacritty -e",
  "confirmSessionLaunch": false,
  "pinToLeadWorkspace": true
}
```

기본 `externalCommand`는 `alacritty -e`이며, 원하는 터미널 명령으로 바꿀 수 있습니다.

`/swarm`, `session_spawn`, `session_bus`로 플릿을 시작, 조종, 종료합니다.

## 🗂️ 저장소 구조

```text
packages/pi-agent-swarm/        pi-agent-swarm 확장 (정식 구현은 src/ 아래)
docs/                     프로젝트 이력, 이미지, 저장소 규약
deprecated/               활성 워크스페이스 스크립트에서 제외된 업스트림 패키지
packages/                 포크에서 보존된 전체 업스트림 pi-extensions 모노레포
```

이 저장소는 [`narumiruna/pi-extensions`](https://github.com/narumiruna/pi-extensions)의 포크입니다.
모든 업스트림 확장 패키지는 `packages/` 아래에 남아 있으며 각자의 README와 라이선스를 유지합니다.

## 📄 라이선스

MIT. [`LICENSE`](./LICENSE) 참조.
