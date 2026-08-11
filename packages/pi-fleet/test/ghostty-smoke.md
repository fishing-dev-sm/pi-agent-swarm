# Ghostty capability smoke

This opt-in smoke verifies the real macOS Ghostty integration that deterministic unit tests replace in CI.

## Preconditions

- Run inside the currently focused Ghostty terminal on macOS.
- Use Ghostty 1.3 or newer with AppleScript enabled.
- Grant macOS Automation permission when prompted.
- Make the current Pi provider and model available to a temporary child Pi session.
- Do not run this smoke in CI or on a shared interactive desktop.

## Command

```bash
npm run smoke:pi-fleet:ghostty
```

## Expected flow

1. The script creates an owner-only parent endpoint and ephemeral group.
2. Native Ghostty AppleScript creates one right-hand split with the package cwd.
3. The split starts a distinct named Pi session with only the local Pi Fleet extension explicitly loaded.
4. The child consumes and deletes its launch envelope, including the parent-only kickoff capability, joins the group, and reports its launch id.
5. The parent sends one non-triggering notify and one capability-authorized launch request.
6. The child uses `session_bus` to send one correlated reply that does not trigger a parent model turn.
7. The script closes only the terminal id returned by Ghostty and removes its launcher, socket, and manifest.

## Deterministic coverage

- `ghostty.test.ts` covers version gating, all split directions, positional arguments, cancellation, Automation denial, missing focus, and stale ownership.
- `launch-integration.test.ts` covers a real child process, cwd and launch-id propagation, environment consumption, authenticated readiness, kickoff delivery, and cleanup with a fake Ghostty boundary.
- `process-transport.test.ts` covers separate-process discovery, authentication, duplicate suppression, group isolation, and cleanup.

## Evidence

- Date: 2026-08-11.
- Environment: macOS with Ghostty 1.3.1 and the active `openai-codex/gpt-5.6-sol` Pi model.
- Native split: Ghostty returned the unique terminal id for one right-hand split.
- Child readiness: a distinct Pi session authenticated with the expected launch id and package cwd.
- Messaging: notify accepted, kickoff accepted, one correlated `smoke-reply` received, and no parent model turn was triggered by the reply.
- Cleanup: the smoke closed only the returned terminal id, the child process stopped, and its manifest and socket disappeared during the bounded shutdown check.
- Hardening discoveries: the first attempts exposed an overlong macOS temporary socket path, unsupported `direct:` syntax in AppleScript surface commands, and a launcher-deletion race before child readiness.
- Regression coverage: `runtime-directory.test.ts`, `launcher.test.ts`, and `spawn.test.ts` now fail if those three defects return.
- Provider path: verified successfully, with no entitlement or external-provider failure.
