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
  <a href="README.pt.md"><strong>Português</strong></a> |
  <a href="README.ru.md">Русский</a>
</p>

Um fork de [`pi-fleet`](./packages/pi-fleet) nativo de gerenciador de janelas para o [Pi Coding Agent](https://pi.dev).
Em vez de tmux ou subprocessos sem interface, cada agente é uma **janela de terminal real** executando uma TUI do Pi completa, organizada em mosaico pelo **gerenciador de janelas i3**.

![Pi Fleet WM executando sob o i3](docs/images/pi-fleet-wm.png)

## Introdução

pi-fleet-wm reconstrói o pi-fleet em torno do gerenciador de janelas i3.
Cada agente roda como uma janela de terminal real (`alacritty -e`) com uma TUI do Pi completa — nunca como um subprocesso sem interface.
Janelas recém-criadas são fixadas no espaço de trabalho i3 da sessão líder, e cada janela mostra um selo no rodapé
(● nome · sessionId · LEADER / WORKER) para distinguir o líder dos trabalhadores de relance.

## Diferenças em relação ao pi-fleet de upstream

- **Janelas reais, sem multiplexador** — o backend `external` abre uma janela de terminal comum (`alacritty -e`) que o i3 organiza em mosaico; sem necessidade de tmux, Zellij ou Ghostty.
- **`pinToLeadWorkspace`** — novas janelas externas caem no espaço de trabalho i3 da sessão líder em vez do espaço focado. O espaço de trabalho líder é localizado percorrendo a árvore de processos até o `_NET_WM_PID` do terminal e então movido com `i3-msg`; o posicionamento é de melhor esforço e nunca bloqueia o lançamento.
- **Papéis líder / trabalhador** — os selos do rodapé mostram `LEADER` / `WORKER` com cores por sessão; `/lead`, `/color`.
- **Retransmissão de direção (steer relay)** — o texto que você digita em uma janela trabalhadora é retransmitido para o contexto do modelo do líder.
- **`session_bus shutdown`** — o líder pode encerrar uma janela trabalhadora de forma ordenada.
- Sessões iniciadas por humanos são nomeadas `MANAGER-<id>` por padrão e tornam-se líder automaticamente.

Consulte [`docs/pi-fleet-project-history.md`](docs/pi-fleet-project-history.md) para o histórico completo de mudanças e [`packages/pi-fleet/README.md`](packages/pi-fleet/README.md) para a referência completa da extensão.

## 🚀 Início rápido

Compile e carregue a extensão a partir deste checkout:

```bash
npm install
npm --workspace @narumitw/pi-fleet run build
pi --no-extensions -e ./packages/pi-fleet
```

Ou instale-a como um pacote local:

```bash
pi install ./packages/pi-fleet
```

Execute sob o i3 com o backend externo:

```json
{
  "defaultTerminal": "external",
  "externalCommand": "alacritty -e",
  "confirmSessionLaunch": false,
  "pinToLeadWorkspace": true
}
```

Use `/fleet`, `session_spawn` e `session_bus` para iniciar, dirigir e desligar a frota.

## 🗂️ Estrutura do repositório

```text
packages/pi-fleet/        A extensão pi-fleet-wm (implementação autoritativa sob src/)
docs/                     Histórico do projeto, imagens e convenções do repositório
deprecated/               Pacotes de upstream excluídos dos scripts ativos do workspace
packages/                 O monorepo upstream pi-extensions completo, preservado do fork
```

Este repositório é um fork de [`narumiruna/pi-extensions`](https://github.com/narumiruna/pi-extensions).
Todos os pacotes de extensão de upstream permanecem sob `packages/` e mantêm seus próprios READMEs e licenças.

## 📄 Licença

MIT. Consulte [`LICENSE`](./LICENSE).
