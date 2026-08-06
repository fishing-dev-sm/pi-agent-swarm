# Repository Guidelines

## Project structure

- This is a Node/TypeScript monorepo for independently installable Pi extensions, reusable publishable libraries, and published experimental packages.
- All active package source lives under `packages/<package>/src/`; each package owns its manifest, README, license, and TypeScript config. Extension manifests declare `piExtension.lifecycle` as `stable` or `experimental`; reusable libraries omit it.
- `deprecated/` contains reference packages excluded from active workspace checks.
- Root config owns shared tooling: `package.json`, `package-lock.json`, `biome.json`, `tsconfig.json`, `justfile`, and `.github/workflows/*`.
- Do not edit `node_modules/`. Generate `package-lock.json` with the npm version declared by root `packageManager`; compare it with `npm --version` before dependency work.
- Keep published contents aligned with each manifest's `files` list and `pi.extensions` entry.
- Keep executable plans current under `docs/plans/` and archive them only after every task and completion check has evidence, as defined by `docs/plans/README.md`.

## Commands

Run commands from the repository root unless noted otherwise.

- Install dependencies: `npm install`
- Full CI-equivalent verification: `npm run check` or `just check`
- Run all active tests: `npm test`
- Format with Biome: `npm run format` or `just format`
- Typecheck all workspaces: `npm run typecheck`
- Preview any package: `just pack <unscoped-name>`
- Try a local extension without installing: `just try <unscoped-name>`
- Inspect available recipes before adding or documenting workflow commands: `just --list`

## Code style

- Root TypeScript uses `module`/`moduleResolution: NodeNext`, `target: ES2022`, `strict: true`, and `noEmit: true`; publishable libraries emit through package-owned build configuration.
- Biome is authoritative: tabs, 100-column line width, double quotes, semicolons, and recommended lint rules.
- Keep extension packages small. Add dependencies only when they solve a current extension need.
- When a Pi core package provides the required function, use that function.
- Check `node_modules` for external API types; don't guess.
- Never remove or downgrade code to fix type errors from outdated dependencies; upgrade the dependency instead.
- Treat each extension package as independently installable and semantically self-contained. Do not import or depend on another extension package, and do not hard-code assumptions about another extension’s package or tool names, argument schemas or actions, settings, event channels, installation state, version, or runtime behavior, whether repository-owned or external. Keep policy in the extension that owns the affected behavior. Share capabilities only through Pi’s public, extension-neutral APIs or reusable non-extension libraries that do not coordinate specific extensions. Consume shared Pi surfaces only generically, without extension-specific branching, and ensure the extension remains functional when all other extensions are absent.
- Every active extension package exposes Pi through a thin `src/index.ts` default-export forwarding entrypoint, and its `package.json` declares exactly `"pi": { "extensions": ["./src/index.ts"] }`; keep implementation in descriptive modules. Publishable libraries emit JavaScript and declarations and must not declare `pi.extensions` or `piExtension`. Run `npm run check:boundaries` to enforce these boundaries.
- Production extensions include source in `pi.extensions`, publish `files`, and root workspace-aware scripts/recipes when users need them. New standard action/detail/settings/multi-select menus should use `@narumitw/pi-tui-kit`; keep domain state, persistence, confirmations, and specialized UI extension-owned.
- Write extension READMEs in English; preserve the emoji title, npm/Pi/license badges, standard emoji section headings, and `## 🗂️ Package layout` during readability passes.
- Standalone experimental extension packages live under `packages/`, declare `"piExtension": { "lifecycle": "experimental" }`, show a user-facing warning, remain covered by root checks, and participate in publishing unless marked `private`. An opt-in experimental feature may remain inside a stable package only when its default behavior stays compatible, configuration explicitly gates it, and enabling it shows a warning.
- Source files over 1,000 lines require decomposition along responsibility boundaries or a documented justification. Generated, vendored, migration, snapshot, and primarily declarative files may justify remaining intact; do not split them mechanically.

## Extension change gates

- Before planning or editing an extension's package, lifecycle, command, menu, custom TUI, settings, status, documentation, or verification behavior, read `docs/extension-conventions.md` completely. Do not defer this reading until review.
- When extension-owned settings are touched—including loading, persistence, validation, precedence, migration, commands, or UI—also read `docs/extension-settings.md` completely before planning or editing.
- Before implementation, identify the touched areas and map them to the applicable **MUST** rules and named verification methods.
- For every asynchronous UI or lifecycle flow, audit user cancellation, component disposal, session replacement, and shutdown separately. Cancel or release every owned task. After each `await`, revalidate any session, generation, context, or mutable state the continuation will use.
- Treat settings reads and writes as one concurrency protocol; audit ordering, failure recovery, stale reads, invalid-file protection, unknown-field preservation, and atomic publication together.
- Before completion, audit the final diff against the guides' touched-area and verification checklists. Passing `npm run check` does not replace this semantic audit.
- When review reveals a convention failure, audit the whole pull-request diff for the same failure class before replying or pushing.
- In the handoff, name the guides read, touched areas audited, checks and smokes run, and any accepted deviation or unverified path.

## Testing and verification

- Active extension tests live under `packages/<package>/test/*.test.ts` and run with `npm test`; archived tests under `deprecated/` are excluded.
- Use `npm run check` as the CI-equivalent local gate; it runs Biome, boundary checks, workspace typechecks, and tests.
- For package metadata or publishing changes, also run `just pack <unscoped-name>` and inspect the tarball contents.
- For Pi runtime behavior, prefer `just try <unscoped-name>` or the equivalent explicit `pi -e` path before publishing.

## Publishing and release safety

- Require explicit user approval before publishing, changing npm visibility, creating version tags, or dispatching release workflows.
- Every publishable package versions independently through Changesets. A pull request that changes published package behavior must add release intent with `npm run changeset`; repository-only documentation, tests, tooling, and path migrations may omit it.
- Publishable experimental packages use the same Changesets version-PR and publishing workflow as stable packages; preserve their experimental warning in user-facing documentation and runtime behavior.
- `just npm-public <package>` only changes visibility for an existing package. If a brand-new scoped package still returns 404, its first approved publication must use `npm publish --workspace <package> --access public`.
- The `publish.yml` workflow creates or updates an independent version PR, then publishes merged versions with package-specific tags and GitHub releases. Initial publication remains a manually approved exception.
- Publish a new `pi-tui-kit` API before raising a consumer's reviewed compatibility floor; do not release an unpublished Kit API and its first consumer together.

## Git and PR guidance

- Before drafting or creating a commit, inspect the selected diff and keep one coherent intent; split unrelated changes.
- Use `<type>[scope][!]: <description>` grounded in the diff. Prefer `feat`, `fix`, `refactor`, or `docs`; omit scope, body, and footers unless useful.
- When committing, stage only intended paths, recheck the index, reject empty commits, then verify and report the commit ID and remaining changes.
- For PRs or handoff notes, include the commands run and any publish/visibility checks performed.

## MEMORY.md

- `MEMORY.md` is not auto-loaded. Check it before non-trivial debugging or design work when prior project context may matter.
- Keep entries short and reusable.
- `MEMORY.md` must use `## GOTCHA` and `## TASTE` sections.
- After a non-trivial error or discovery, add one concise entry if it will help future work.
