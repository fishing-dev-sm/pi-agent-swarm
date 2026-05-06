# pi-skillforge

Pi package for improving agent skills through verified project memory.

`pi-skillforge` captures recurring gotchas, fixes, decisions, and workflow learnings from coding-agent sessions, stores them as structured project-local memory, retrieves only relevant entries for active skills, and promotes stable repeated learnings into proposed skill improvements.

## Status

Early implementation. The package exposes `/skillforge` commands for project-local memory storage initialization, validation, and index rebuilding. See [PLAN.md](./PLAN.md) for the product plan and memory model.

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
/skillforge init       # create .pi-skillforge/ storage in the current project
/skillforge validate   # validate memory files and rebuild index.json
/skillforge reindex    # rebuild index.json from valid memory files
```

Memory entries can be Markdown-with-frontmatter, YAML, or JSON files under `.pi-skillforge/memory/`.

## Package layout

This repository follows Pi package conventions:

```txt
pi-skillforge/
├── extensions/
│   └── skillforge.ts
├── lib/
│   ├── parse.ts
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
