# Changesets

Add one changeset Markdown file for every pull request that should release one or more packages:

```bash
npm run changeset
```

Choose each affected package and its SemVer bump. Changesets are consumed by the automated version
pull request, which updates only selected package versions and changelogs. Documentation, tests,
repository tooling, and package moves that do not change published package behavior may omit a
changeset.

Packages version independently. Do not add `fixed` or `linked` groups. Publish a new
`@narumitw/pi-tui-kit` API before raising an extension's dependency floor to consume it; do not use a
single changeset to release an unpublished Kit API and its first consumer together.
