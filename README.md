# pi-skillforge

Pi package for improving agent skills through verified global memory and reviewed skill patches.

`pi-skillforge` automatically captures verified gotchas, fixes, decisions, and workflow learnings from coding-agent sessions, stores them under Pi's global agent directory, retrieves only relevant entries for active skills, and promotes stable repeated learnings into skill patch proposals.

## Status

Early implementation. The package supports global-only project-aware memory storage, automatic retrieval injection, agent-mediated automatic capture, and automatic skill patch proposal generation. The only user-facing command reviews pending patches for one skill and applies them after explicit approval.

See [PLAN.md](./PLAN.md) for the product plan and memory model.

## Install

Install from npm:

```bash
pi install npm:@narumitw/pi-skillforge
```

Try without installing permanently:

```bash
pi -e npm:@narumitw/pi-skillforge
```

For local development:

```bash
pi -e .
```

## Usage

`pi-skillforge` is designed to be zero-maintenance during normal agent work. After the package is loaded, there is no setup command and no manual memory workflow.

What happens automatically:

1. Before each agent turn, relevant project/global memories are retrieved and injected as hidden context.
2. During work, the agent may call `skillforge_capture_memory` when it has a verified reusable gotcha, decision, or pattern.
3. When a confirmed memory becomes stable enough, the extension writes a pending skill patch proposal under the global Skillforge store.

The only user-facing command is for reviewing generated skill patches:

```text
/skillforge <skill-name>
```

Example:

```text
/skillforge python-typer
```

This command:

1. Finds pending patch proposals for the named skill.
2. Shows the target skill, source memory, proposed guidance, rationale, and verification evidence.
3. Asks for approval before editing the target `SKILL.md`.
4. Marks the proposal as applied and appends to `promotion-log.md` after a successful apply.

It does not apply patches without confirmation.

There are intentionally no commands for init, capture, retrieve, validate, reindex, or promote; those flows are automatic/internal.

## Storage

All pi-skillforge data is stored under Pi's global agent directory:

```txt
${PI_CODING_AGENT_DIR:-~/.pi/agent}/skillforge/
├── memory/
│   ├── global/
│   │   ├── gotchas/
│   │   ├── decisions/
│   │   └── patterns/
│   └── projects/
│       └── <project-id>/
│           ├── gotchas/
│           ├── decisions/
│           └── patterns/
├── promotions/
│   ├── global/
│   └── projects/
│       └── <project-id>/
├── registry.yaml
├── index.json
└── promotion-log.md
```

There is no repo-local `.pi-skillforge/` store. Project-specific memories are isolated by `<project-id>` inside the global store; retrieval reads only the current project partition plus the global partition.

## Workflows

### Automatic capture

The extension registers the `skillforge_capture_memory` tool. The agent may use it automatically when the current task produces a verified, reusable gotcha, decision, or pattern with concrete evidence.

Capture rules are intentionally conservative:

- Do not capture speculation or ordinary chat history.
- Capture only reusable learnings with prevention value.
- Include trigger, symptom, root cause, fix, verification, scope, and confidence.
- Prefer the project partition for project-specific learnings.
- Use the global partition only for clearly cross-project learnings.

### Automatic retrieval

Before each agent turn, the extension retrieves relevant memories from:

- the current project partition
- the global partition

Relevant memories are injected as hidden concise context. Unrelated memories are not injected.

Retrieval rules are conservative:

- `draft` and `deprecated` memories are ignored.
- `excluded_skills` blocks injection when a loaded skill is excluded.
- Skill-scoped memories require a loaded `skills` or `compatible_skills` match.
- Prompt/scope terms must also match, so a loaded skill alone is not enough.

### Automatic promotion

Confirmed memories become skill patch proposals automatically when they are stable enough.

MVP promotion criteria:

- `confidence: confirmed`
- `hits >= 3`
- at least one target `skills` entry

Promotion is checked after a memory is saved and after relevant memories are retrieved. The extension generates proposal files under `promotions/`, but does not modify `SKILL.md` until you run `/skillforge <skill-name>` and approve the patch.

## Package layout

```txt
pi-skillforge/
├── extensions/
│   └── skillforge.ts
├── lib/
│   ├── capture.ts
│   ├── parse.ts
│   ├── promotion.ts
│   ├── retrieve.ts
│   ├── serialize.ts
│   ├── storage.ts
│   ├── types.ts
│   └── validate.ts
├── schemas/
├── templates/
├── examples/
├── PLAN.md
├── README.md
└── package.json
```

The package exposes its extension through `package.json`:

```json
{
	"pi": {
		"extensions": ["./extensions"]
	}
}
```

## Development

Install dependencies:

```bash
npm install
```

Useful commands:

```bash
just check       # biome check + typecheck
just format      # format files with Biome
just hooks       # install pre-commit hooks
just pack        # preview npm package contents
just publish     # publish with --access public
just verify-npm  # check npm registry metadata
```

## Release

Typical patch release:

```bash
just bump patch
just check
just publish
just tag
```

For scoped npm packages, publishing must use public access. The `just publish` recipe already runs:

```bash
npm publish --access public
```

If `npm publish` succeeds but `pi install npm:@narumitw/pi-skillforge` returns 404 immediately afterwards, wait a few minutes for npm registry metadata to propagate, then run:

```bash
just verify-npm
```
