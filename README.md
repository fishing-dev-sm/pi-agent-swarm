# pi extensions

Monorepo for independently installable Pi extension packages.

## Packages

| Package | Source | Install |
| --- | --- | --- |
| `@narumitw/pi-skillforge` | [`extensions/pi-skillforge`](./extensions/pi-skillforge) | `pi install npm:@narumitw/pi-skillforge` |
| `@narumitw/pi-retry` | [`extensions/pi-retry`](./extensions/pi-retry) | `pi install npm:@narumitw/pi-retry` |

## Local development

Run checks for all packages:

```bash
npm run check
```

Try a package locally:

```bash
pi -e ./extensions/pi-skillforge
pi -e ./extensions/pi-retry
```

Preview package contents:

```bash
npm run pack:skillforge
npm run pack:retry
```

Publish packages from their package directories:

```bash
cd extensions/pi-skillforge && npm publish --access public
cd extensions/pi-retry && npm publish --access public
```
