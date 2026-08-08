# Repository Guidelines

## Documentation and communication

- Keep documents and conversations concise, clear, and accurate.
- Explain things simply enough for a child to understand.
- Write one sentence per line in prose.

## Repository structure

- This Node.js and TypeScript monorepo contains Pi extensions and reusable libraries.
- Keep active package source under `packages/<package>/src/`.
- Each package owns its manifest, README, license, and TypeScript configuration.
- Set each extension's `piExtension.lifecycle` to `stable` or `experimental`.
- Omit `piExtension` from reusable libraries.
- Keep deprecated reference packages under `deprecated/`, which active checks exclude.
- Root files such as `package.json`, `package-lock.json`, `biome.json`, `tsconfig.json`, `justfile`, and `.github/workflows/*` own shared tooling.
- Never edit `node_modules/`.
- Read `node_modules/` to confirm external API types and usage instead of guessing.
- Keep published files aligned with each manifest's `files` list and `pi.extensions` entry.
- Keep plans current under `docs/plans/` and follow `docs/plans/README.md` before archiving them.

## Commands

Run commands from the repository root unless a command says otherwise.

- Run `npm install` to install dependencies.
- Run `npm run check` or `just check` for the CI-equivalent verification gate.
- Run `npm test` to execute all active tests.
- Run `npm run format` or `just format` to format with Biome.
- Run `npm run typecheck` to typecheck every workspace.
- Run `just pack <unscoped-name>` to preview a package.
- Run `just try <unscoped-name>` to test a local extension in Pi.
- Run `just --list` before adding or documenting a workflow command.

## Code and package rules

- Root TypeScript uses NodeNext modules, ES2022, strict mode, and no emit.
- Publishable libraries emit through their own build configuration.
- Biome requires tabs, double quotes, semicolons, a 100-column line width, and recommended lint rules.
- Keep extension packages small.
- Add dependencies only for current package needs.
- Use a Pi core function when Pi already provides the required behavior.
- Upgrade an outdated dependency instead of hiding its type errors by removing or downgrading code.
- Keep every extension independently installable and functional by itself.
- Do not import or depend on another extension package.
- Do not assume another extension's names, schemas, settings, events, installation state, version, or behavior.
- Keep policy in the extension that owns the affected behavior.
- Share code only through Pi's public extension-neutral APIs or reusable non-extension libraries.
- Do not make reusable libraries coordinate specific extensions.
- Consume shared Pi APIs without extension-specific branches.
- Give every active extension a thin `src/index.ts` default-export forwarder.
- Declare exactly `"pi": { "extensions": ["./src/index.ts"] }` in every active extension manifest.
- Keep extension implementation in descriptively named modules.
- Publish reusable libraries as JavaScript with declarations and without `pi.extensions` or `piExtension`.
- Run `npm run check:boundaries` to verify package boundaries.
- List every stable extension entrypoint in the root `package.json` under `pi.extensions`.
- Do not list experimental extension entrypoints in the root `package.json` under `pi.extensions`.
- Add root workspace scripts or recipes when users need them.
- Use `@narumitw/pi-tui-kit` for new standard action, detail, settings, and multi-select menus.
- Keep domain state, persistence, confirmations, and specialized UI inside the owning extension.
- Write extension READMEs in English.
- Preserve each README's emoji title, npm badge, Pi badge, license badge, standard emoji sections, and `## 🗂️ Package layout`.
- Keep standalone experimental extensions under `packages/` with `"piExtension": { "lifecycle": "experimental" }`.
- Show a user-facing warning for experimental extensions and features.
- Keep experimental packages in root checks and publishing unless they are private.
- Gate an experimental feature inside a stable package with explicit configuration and compatible default behavior.
- Split source files over 1,000 lines by clear responsibilities or document why they must stay intact.
- Do not mechanically split generated, vendored, migration, snapshot, or mainly declarative files.

## Extension change gates

- Read `docs/extension-conventions.md` completely before planning or editing any extension.
- This gate covers package metadata, lifecycle, commands, menus, custom TUI, settings, status, documentation, and verification behavior.
- Also read `docs/extension-settings.md` completely before changing extension-owned settings.
- This settings gate covers loading, persistence, validation, precedence, migration, commands, and UI.
- Before implementation, map every touched area to its applicable **MUST** rules and verification methods.
- Audit user cancellation, component disposal, session replacement, and shutdown for every asynchronous UI or lifecycle flow.
- Cancel or release every task owned by the flow.
- Revalidate stale sessions, generations, contexts, and mutable state after each `await`.
- Treat settings reads and writes as one concurrency protocol.
- Audit settings ordering, failure recovery, stale reads, invalid-file protection, unknown-field preservation, and atomic publication together.
- Audit the final diff against the guides' touched-area and verification checklists.
- Do not use a passing `npm run check` as a substitute for the semantic audit.
- When review finds one convention failure, inspect the whole pull-request diff for the same failure class.
- Name the guides, audits, checks, smokes, deviations, and unverified paths in the handoff.

## Testing and verification

- Keep active tests under `packages/<package>/test/*.test.ts` and run them with `npm test`.
- Keep archived tests under `deprecated/` and outside active checks.
- Use `npm run check` as the CI-equivalent gate for Biome, boundaries, typechecks, and tests.
- Run `just pack <unscoped-name>` and inspect the tarball after package metadata or publishing changes.
- Run `just try <unscoped-name>` or an equivalent `pi -e` command for Pi runtime behavior when practical.

## Publishing and release safety

- Get explicit user approval before publishing, changing npm visibility, creating version tags, or dispatching release workflows.
- Version every publishable package independently through Changesets.
- Add a changeset when a pull request changes published package behavior.
- Repository-only documentation, tests, tooling, and path migrations may omit a changeset.
- Release experimental packages through the same Changesets workflow as stable packages.
- Preserve experimental warnings in documentation and runtime behavior.
- Use `just npm-public <package>` only to change the visibility of an existing package.
- Use `npm publish --workspace <package> --access public` for the first approved publication of a new scoped package that still returns 404.
- Treat initial publication as a manually approved exception.
- Let `publish.yml` manage the version pull request, package tags, publications, and GitHub releases.
- Publish a new `pi-tui-kit` API before raising a consumer's compatibility floor.
- Do not release an unpublished Kit API together with its first consumer.

## Git and pull requests

- Inspect the selected diff and keep each commit focused on one intent.
- Use `<type>[scope][!]: <description>` based on the actual diff.
- Prefer `feat`, `fix`, `refactor`, or `docs`, and omit unused scope, body, or footers.
- Stage only intended paths, recheck the index, reject empty commits, and report the commit ID and remaining changes.
- Include checks and publish or visibility evidence in pull-request or handoff notes.

## MEMORY.md

- `MEMORY.md` is not loaded automatically.
- Read it at the start of repository work and let current evidence override it.
- Keep entries short, reusable, and verified.
- Use exactly `## GOTCHA`, `## TASTE`, and `## CONVENTIONS` as its top-level sections.
- Add a note only when a verified discovery will help future work.
