# 🪟 Pi Agent Swarm

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev)

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.pt.md"><strong>Português</strong></a> |
  <a href="README.ru.md">Русский</a>
</p>

Um fork de [`pi-agent-swarm`](./packages/pi-agent-swarm) nativo de gerenciador de janelas para o [Pi Coding Agent](https://pi.dev).
Em vez de tmux ou subprocessos sem interface, cada agente é uma **janela de terminal real** executando uma TUI do Pi completa, organizada em mosaico por qualquer gerenciador de janelas em mosaico.

![Pi Agent Swarm em execução](docs/images/pi-agent-swarm.png)

## Introdução

pi-agent-swarm reconstrói o pi-agent-swarm em torno de um gerenciador de janelas em mosaico.
Cada agente roda como uma janela de terminal real com uma TUI do Pi completa — nunca como um subprocesso sem interface.
Janelas recém-criadas são fixadas no espaço de trabalho da sessão líder, e cada janela mostra um selo no rodapé
(● nome · sessionId · LEADER / WORKER) para distinguir o líder dos trabalhadores de relance.

## Diferenças em relação ao pi-agent-swarm de upstream

- **Janelas reais, sem multiplexador** — o backend `external` abre uma janela de terminal comum que seu gerenciador de janelas organiza em mosaico; sem necessidade de tmux, Zellij ou Ghostty.
- **`pinToLeadWorkspace`** — novas janelas externas caem no espaço de trabalho da sessão líder em vez do espaço focado. O espaço de trabalho líder é localizado percorrendo a árvore de processos até o `_NET_WM_PID` do terminal e então movido com o gerenciador de janelas; o posicionamento é de melhor esforço e nunca bloqueia o lançamento.
- **Papéis líder / trabalhador** — os selos do rodapé mostram `LEADER` / `WORKER` com cores por sessão; `/lead`, `/color`.
- **Retransmissão de direção (steer relay)** — o texto que você digita em uma janela trabalhadora é retransmitido para o contexto do modelo do líder.
- **`session_bus shutdown`** — o líder pode encerrar uma janela trabalhadora de forma ordenada.
- Sessões iniciadas por humanos são nomeadas `MANAGER-<id>` por padrão e tornam-se líder automaticamente.

Consulte [`docs/pi-agent-swarm-project-history.md`](docs/pi-agent-swarm-project-history.md) para o histórico completo de mudanças e [`packages/pi-agent-swarm/README.md`](packages/pi-agent-swarm/README.md) para a referência completa da extensão.

## 🚀 Início rápido

Compile e carregue a extensão a partir deste checkout:

```bash
npm install
npm --workspace pi-agent-swarm run build
pi --no-extensions -e ./packages/pi-agent-swarm
```

Ou instale-a como um pacote local:

```bash
pi install ./packages/pi-agent-swarm
```

Execute com o backend externo:

```json
{
  "defaultTerminal": "external",
  "externalCommand": "alacritty -e",
  "confirmSessionLaunch": false,
  "pinToLeadWorkspace": true
}
```

O `externalCommand` padrão é `alacritty -e`; use o comando de terminal que preferir.

Use `/swarm`, `session_spawn` e `session_bus` para iniciar, dirigir e desligar a frota.

## 🗂️ Estrutura do repositório

```text
packages/pi-agent-swarm/        A extensão pi-agent-swarm (implementação autoritativa sob src/)
docs/                     Histórico do projeto, imagens e convenções do repositório
deprecated/               Pacotes de upstream excluídos dos scripts ativos do workspace
packages/                 O monorepo upstream pi-extensions completo, preservado do fork
```

Este repositório é um fork de [`narumiruna/pi-extensions`](https://github.com/narumiruna/pi-extensions).
Todos os pacotes de extensão de upstream permanecem sob `packages/` e mantêm seus próprios READMEs e licenças.

## 📄 Licença

MIT. Consulte [`LICENSE`](./LICENSE).
