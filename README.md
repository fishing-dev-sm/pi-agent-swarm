# pi-skillforge

Pi package for improving agent skills through verified project memory.

`pi-skillforge` captures recurring gotchas, fixes, decisions, and workflow learnings from coding-agent sessions, stores them as structured project-local memory, retrieves only relevant entries for active skills, and promotes stable repeated learnings into proposed skill improvements.

## Status

Early implementation. The package now supports project-local memory initialization, reviewed capture, schema validation, conservative retrieval injection, and retrieval debugging. Promotion into skill patch proposals is still planned. See [PLAN.md](./PLAN.md) for the product plan and memory model.

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

After loading the package in Pi, run:

```text
/skillforge
```

Useful commands:

```text
/skillforge init              # create .pi-skillforge/ storage in the current project
/skillforge capture gotcha    # open a reviewed memory-entry draft in the editor
/skillforge capture decision  # capture a project decision
/skillforge capture pattern   # capture a reusable successful pattern
/skillforge retrieve <prompt> # preview retrieval scores and reasons
/skillforge search <prompt>   # alias for retrieve
/skillforge validate          # validate memory files and rebuild index.json
/skillforge reindex           # rebuild index.json from valid memory files
```

Memory entries can be Markdown-with-frontmatter, YAML, or JSON files under `.pi-skillforge/memory/`.

## Workflows

### Capture reviewed project memory

Use the interactive capture command when you want to record a verified lesson:

```text
/skillforge capture gotcha
```

The command opens a draft entry in Pi's editor. Replace every placeholder before saving. Entries must include trigger, symptom, root cause, fix, verification, scope, confidence, and hit count.

The extension also registers the `skillforge_capture_memory` tool. The agent should only use it when you explicitly ask to remember or capture a verified gotcha, decision, or pattern.

### Retrieve relevant memory

Before each agent turn, the extension conservatively retrieves confirmed or observed memories that match the prompt, loaded skill metadata, and memory scope. Relevant memories are injected as a hidden concise context message; unrelated memory is not injected.

Retrieval rules are intentionally conservative:

- `draft` and `deprecated` memories are ignored.
- `excluded_skills` blocks injection when a loaded skill is excluded.
- Skill-scoped memories require a loaded `skills` or `compatible_skills` match.
- Prompt/scope terms must also match, so a loaded skill alone is not enough.

To debug retrieval without starting an agent turn, run:

```text
/skillforge retrieve update ruff settings in pyproject.toml
```

The preview shows matching memory ids, scores, reasons, paths, and the first fix line.

## Package layout

This repository follows Pi package conventions:

```txt
pi-skillforge/
├── extensions/
│   └── skillforge.ts
├── lib/
│   ├── capture.ts
│   ├── parse.ts
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
