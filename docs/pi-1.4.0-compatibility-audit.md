# Pi 1.4.0 compatibility audit

Audit of pi-agent-swarm against Pi Coding Agent 1.4.0 (previously developed and tested against 1.0.2). Outcome: one dependency-tree defect found and fixed; no source API migration required.

## Finding: mixed 1.0.2 / 1.4.0 dependency tree

The workspace root devDependencies had been upgraded to 1.4.0, but `packages/pi-agent-swarm/package.json` still pinned 1.0.2. npm therefore kept a nested pi-coding-agent@1.0.2 under the package while hoisting pi-codemode@1.4.0 to the root.

- pi-coding-agent@1.0.2 imports `MCP_TYPESCRIPT_PREAMBLE` from `@earendil-works/pi-codemode/declarations`.
- pi-codemode@1.4.0 no longer exports that symbol.
- Result: 8 test files failed at import time with `SyntaxError: The requested module '@earendil-works/pi-codemode/declarations' does not provide an export named 'MCP_TYPESCRIPT_PREAMBLE'`, while `tsc --noEmit` still passed. Pure runtime/module-resolution breakage, invisible to typechecking.

Fix: align all Pi packages at 1.4.0 in both the root and package devDependencies (`pi-server` has no 1.4.0 release; it uses its latest 1.1.0). The tree now dedupes to a single consistent 1.4.0 set.

Commit: `810c44e6 fix(deps): align Pi packages at 1.4.0 across workspace and package devDependencies`.

Lesson: bump Pi devDependencies in the root and in `packages/pi-agent-swarm/package.json` together; a partial bump creates a mixed tree that typechecks but fails at import time.

## Verification

- `npm test`: 27 test files, 155/155 tests pass.
- `npm run check`: build, Biome, boundaries, and workspace typechecks pass.
- Runtime smoke: installed Pi 1.4.0 loaded the built `dist` extension via `pi --no-extensions --no-skills --no-session -e ./packages/pi-agent-swarm -p ...` and responded normally.

## API surface audit (1.0.2 → 1.4.0)

No breaking signature changes in any API the extension uses: `registerTool`, `registerCommand`, `ctx.ui.confirm/select/input/notify/setStatus`, `sessionManager.getSessionId/getBranch`, model registry `find/complete/setModel`, thinking levels, `pi.exec`, TUI `Text`, width/color helpers, and keybindings. `@narumitw/pi-tui-kit@0.59.0` remains compatible; 1.4.0 overlay concurrency fixes reduce UI risk for the swarm menu.

Two semantic changes worth knowing (no code change needed):

1. Since 1.2.0, custom messages with `triggerTurn: true` fire `before_agent_start`. This affects other extensions listening to that event, which must narrow by `event.messageType` before reading `event.prompt`. Swarm itself does not listen to the event; do not replace its shutdown/cleanup custom runs with `sendUserMessage()`, which would leak control text into model context.
2. Azure provider ID was renamed (`azure-openai-responses` → `azure`). Only relevant to users with old Azure model configurations; fix user config, not the extension.

RPC/print/JSON mode isolation in the extension remains correct: `/swarm` and `session_spawn` are TUI/RPC-only, notifications are guarded by `hasUI`, and no terminal `custom()` component is used in RPC.

## Non-goals

New 1.4.0 capabilities (fullscreen transcript viewport, `ViewportTUI.setLayoutRoot`, `ScrollView`, fullscreen mouse routing, `ToolDefinition.reachesTools`) are additive feature-evolution opportunities, not compatibility obligations. No adoption planned.
