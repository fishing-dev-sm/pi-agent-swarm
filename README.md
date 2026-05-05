# pi-skillforge

Pi package for improving agent skills through verified project memory.

`pi-skillforge` captures recurring gotchas, fixes, decisions, and workflow learnings from coding-agent sessions, stores them as structured project-local memory, retrieves only relevant entries for active skills, and promotes stable repeated learnings into proposed skill improvements.

## Status

Early scaffold. See [PLAN.md](./PLAN.md) for the product plan and memory model.

## Development

Install dependencies:

```bash
npm install
```

Useful commands:

```bash
just check      # biome check + typecheck
just format     # format files with Biome
just hooks      # install pre-commit hooks
just pack       # preview npm package contents
```

## Pi package

The package exposes its extension through `package.json`:

```json
{
	"pi": {
		"extensions": ["./extensions"]
	}
}
```

This follows Pi's package convention: extension entry files live under `extensions/`.

For local testing:

```bash
pi -e .
```
