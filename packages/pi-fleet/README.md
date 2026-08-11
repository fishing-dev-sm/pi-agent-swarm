# 🚀 Pi Fleet — Experimental Local Pi Sessions

[![npm](https://img.shields.io/npm/v/@narumitw/pi-fleet)](https://www.npmjs.com/package/@narumitw/pi-fleet) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

> [!WARNING]
> Pi Fleet is experimental.
> Its local protocol, Ghostty automation, tool schemas, and agent-request behavior may change between releases.

`@narumitw/pi-fleet` starts a separate Pi process in a new Ghostty split while preserving the parent session.
It also lets explicitly joined Pi sessions owned by the same operating-system user exchange bounded local messages and one-turn requests.

## ✨ Features

- Starts a distinct Pi process through Ghostty's native macOS AppleScript API.
- Preserves the parent Pi session instead of replacing it with `ctx.newSession()`.
- Inherits the parent cwd, model identity, thinking level, and an optional first task.
- Waits for an authenticated child endpoint before reporting that the new session is ready.
- Connects explicit sessions through owner-only Unix sockets and ephemeral bearer invites.
- Authenticates frames with HMAC-SHA-256 and bounds frames, messages, peers, rates, deadlines, and deduplication state.
- Delivers notify messages without starting a model turn.
- Starts at most one turn for an allowed request or launch kickoff, while replies do not trigger another automatic turn.
- Cleans sockets, manifests, connections, launchers, tasks, timers, and status on leave, replacement, reload, and shutdown.

## 📦 Install

Install persistently after the package is published:

```bash
pi install npm:@narumitw/pi-fleet
```

Try the published package without a permanent install:

```bash
pi -e npm:@narumitw/pi-fleet
```

Load the extension from a local checkout:

```bash
pi --no-extensions --no-skills --no-session -e ./packages/pi-fleet
```

A child started by Ghostty uses normal Pi extension discovery.
Install Pi Fleet persistently before testing the complete split-and-auto-join flow because a parent's temporary `-e` argument is not copied into the child process.

Pi extensions execute with your user permissions.
Review extension source before installing it.

## 🚀 Quick start

Run:

```text
/fleet
```

Choose **New Pi session in Ghostty**.

Pi Fleet asks for a split direction and an optional first task.
It then shows the experimental warning and an exact launch preview before creating any socket or split.

After confirmation, Pi Fleet:

1. Creates or reuses an ephemeral local group.
2. Creates the Ghostty split.
3. Starts a separate named Pi process in the selected cwd.
4. Waits for the child to authenticate and report readiness.
5. Sends the optional first task through a launch-specific one-time kickoff.

If Ghostty creates the split but the child does not become ready, Pi Fleet leaves the visible split open and reports a partial launch instead of closing a potentially useful terminal.

## 🧰 Tools

### `session_spawn`

Creates a separate Pi process in a Ghostty split.

| Parameter | Required | Description |
| --- | --- | --- |
| `direction` | No | `right`, `down`, `left`, or `up`; defaults to `right`. |
| `task` | No | First task sent only after authenticated readiness. |
| `name` | No | Child session display name. |
| `cwd` | No | Existing directory; defaults to the current cwd. |

The tool works only in TUI and RPC modes because it requires user confirmation.
JSON and print modes fail before creating a group, launcher, or split.

### `session_bus`

Lists or messages sessions in the active Pi Fleet group.

| Action | Fields | Behavior |
| --- | --- | --- |
| `list` | none | Lists authenticated live peers and request policy. |
| `send` | `targetSessionId`, `message`, optional `mode` | Sends `notify` by default or a permitted one-turn `request`. |
| `reply` | `targetSessionId`, `message`, `replyTo` | Correlates a reply without starting another automatic turn. |

An accepted acknowledgement means the recipient extension accepted or deduplicated the message.
It does not prove that a remote agent completed the requested work.

## 💬 Commands

| Command | Modes | Description |
| --- | --- | --- |
| `/fleet` | TUI, RPC | Open the state-aware Pi Fleet manager. |
| `/fleet <pifleet:v1:invite>` | TUI, RPC | Review warnings and join one ephemeral local group. |

Unknown and trailing arguments are rejected.
JSON and print command routes fail before opening sockets or custom UI.

The manager keeps **New Pi session in Ghostty** first whether connected or disconnected.
Connected sessions can send a message, inspect peers, copy the explicit invite, change request policy, inspect status and help, or leave the group.

## 🍎 Ghostty requirements

Split automation currently requires:

- macOS.
- Ghostty 1.3 or newer.
- Pi running in the currently focused Ghostty terminal.
- macOS Automation permission for the process hosting Pi to control Ghostty.

Pi Fleet uses Ghostty's native `split` AppleScript command with positional arguments.
It does not simulate user key presses or depend on customized keybindings.

The first launch may trigger a macOS Automation permission prompt.
If permission is denied, enable it in **System Settings → Privacy & Security → Automation** and retry.

## ⚙️ Settings and lifecycle

Pi Fleet has no user or project settings file in this release.

Group secrets, request permission, peers, readiness state, and deduplication state are held only in memory by Pi Fleet.
A copied invite is still a reusable bearer secret, so discard it or start a new group when you need to rotate access.
A short-lived in-process handoff preserves a group across `/reload` for the same `sessionManager` only.
Membership does not carry into `/new`, `/resume`, or another logical session without a new invite.

The Ghostty child receives an internal launch-only environment envelope.
The child consumes and deletes those values during `session_start` before Pi tools can inherit them.
These values are not user settings or supported environment overrides.

Incoming agent requests are blocked by default.
Enabling them permits trusted invite holders to start paid model turns that may edit the same workspace concurrently.

## 🔒 Security and privacy

- Runtime directories are owned by the current user and restricted to `0700`.
- Endpoint manifests and Unix sockets are restricted to `0600`.
- Discovery ignores symlinks, non-regular files, oversized manifests, escaping socket paths, wrong owners, malformed records, and incompatible versions.
- Every request and response is authenticated for its group, target, claimed sender, clock window, nonce, and request id.
- The shared group MAC proves possession of the bearer invite, not a separate cryptographic identity for each peer.
- A trusted invite holder can claim another session id, so session labels are collaboration hints rather than an authorization boundary.
- Bearer invites are shown only on the explicit invite screen or direct join input.
- Pi Fleet does not persist invites, but a recipient can copy and reuse one until every holder discards it or moves to a new group.
- Invites are not placed in tool output, status, notifications, custom renderers, launch scripts, or model context.
- Peer names, paths, messages, model ids, and errors are treated as untrusted terminal text and sanitized only at display boundaries.
- A same-user process or another privileged Pi extension is outside the security boundary and may inspect process memory or environment.
- Pi Fleet provides explicit group separation, not a sandbox against the operating-system user.

## 🧪 Experimental limitations

- Local same-user communication only.
- POSIX Unix-socket transport only.
- Ghostty split automation only on macOS.
- No LAN, internet, cross-user, remote-host, or public-room transport.
- No daemon, offline mailbox, separate Fleet history, delivery receipt, global ordering, or exactly-once guarantee.
- No automatic trust or discovery of every Pi process.
- No automatic close of a split after partial child startup.
- No tab, window, resize, focus-navigation, or general layout manager.
- Multiple Pi sessions can still race while editing the same workspace.

## 🗂️ Package layout

```text
packages/pi-fleet/
├── src/
│   ├── index.ts
│   ├── pi-fleet.ts
│   ├── fleet-controller.ts
│   ├── tools.ts
│   ├── menu.ts
│   ├── protocol.ts
│   ├── transport.ts
│   ├── runtime-directory.ts
│   ├── ghostty.ts
│   ├── pi-invocation.ts
│   ├── launcher.ts
│   ├── launch-envelope.ts
│   ├── renderer.ts
│   └── text.ts
├── scripts/
│   └── ghostty-smoke.ts
├── test/
├── README.md
├── LICENSE
├── package.json
├── tsconfig.json
└── tsconfig.process-smoke.json
```

## 🔎 Keywords

Pi extension, Pi Fleet, Pi sessions, Ghostty split, local agents, agent communication, Unix socket, TypeScript.

## 📄 License

MIT.
See [`LICENSE`](./LICENSE).
