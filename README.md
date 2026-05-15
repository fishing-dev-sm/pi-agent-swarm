# pi extensions

Monorepo for independently installable Pi extension packages.

## Packages

| Package | Source | Install |
| --- | --- | --- |
| `@narumitw/pi-goal` | [`extensions/pi-goal`](./extensions/pi-goal) | `pi install npm:@narumitw/pi-goal` |
| `@narumitw/pi-retry` | [`extensions/pi-retry`](./extensions/pi-retry) | `pi install npm:@narumitw/pi-retry` |

## Local development

Run checks for all packages:

```bash
npm run check
```

Try a package locally:

```bash
pi -e ./extensions/pi-goal
pi -e ./extensions/pi-retry
```

Preview package contents:

```bash
npm run pack:goal
npm run pack:retry
```

Publish packages from their package directories:

```bash
cd extensions/pi-goal && npm publish --access public
cd extensions/pi-retry && npm publish --access public
```
