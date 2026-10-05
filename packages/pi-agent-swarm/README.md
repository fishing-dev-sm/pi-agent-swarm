# 🚀 Pi Agent Swarm — Launch and Connect Local Pi Sessions

[![npm](https://img.shields.io/npm/v/pi-agent-swarm)](https://www.npmjs.com/package/pi-agent-swarm) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Launch another Pi process in an external terminal window without replacing the current session.
You can also connect trusted local Pi sessions for bounded notifications and one-turn requests.
Every agent is a real terminal window tiled by your window manager — never a headless child process.

## ✨ Features

- Opens a distinct Pi process in an external terminal window while preserving the parent session.
- Pins each new window to the lead session's workspace instead of the focused one.
- Inherits the cwd, model, thinking level, and optional first task after launch review.
- Waits for the child to authenticate before reporting that the new session is ready.
- Connects explicitly joined same-user sessions through owner-only local sockets and ephemeral invites.
- Delivers notifications without a model turn and bounds each allowed request to one turn.
- Relays user input from a worker window into the leader's model context.
- Authenticates and bounds local protocol traffic, peers, retries, rates, deadlines, and diagnostics.
- Cleans all sockets, launchers, tasks, timers, and status on leave, reload, replacement, or shutdown.

## 📦 Install

Install persistently:

```bash
pi install npm:pi-agent-swarm
```

Try the published package without a permanent install:

```bash
pi -e npm:pi-agent-swarm
```

Build and load the extension from a local checkout:

```bash
npm --workspace pi-agent-swarm run build
pi --no-extensions --no-skills --no-session -e ./packages/pi-agent-swarm
```

The package declares `dist/index.ts`, so an unbuilt local checkout must run the build before Pi loads the package directory.
A child started in any terminal uses normal Pi extension discovery.
Install Pi Agent Swarm persistently to test spawn-and-auto-join because the child does not inherit the parent's temporary `-e` argument.

Pi extensions execute with your user permissions.
Review extension source before installing it.

## 🚀 Quick start

Run `/swarm`, choose **New Pi session…**, select a window direction, and optionally enter a first task.
Before creating a window, Pi Agent Swarm asks for the configured launch confirmation.

## 🧭 Launch flow

Use **Settings** to change final launch confirmation or toggle lead-workspace pinning.
New windows are launched through the configured external terminal command.

After any configured launch confirmation, Pi Agent Swarm:

1. Creates or reuses an ephemeral local group.
2. Starts the external terminal command.
3. Starts a separate named Pi process in the selected cwd.
4. Waits for the child to authenticate and report readiness.
5. Sends the optional first task through a launch-specific one-time kickoff.

If the terminal creates a window but the child does not become ready, Pi Agent Swarm reports a partial launch.
It leaves the visible window open instead of closing a potentially useful process.

## 🛠️ Tools

### `session_spawn`

Creates a separate Pi process in an external terminal window.

| Parameter | Required | Description |
| --- | --- | --- |
| `direction` | No | `right`, `down`, `left`, or `up`; defaults to `right`. |
| `task` | No | First task sent only after authenticated readiness. |
| `name` | No | Child session display name. |
| `color` | No | Child color: a palette name or a `#rrggbb` hex. |
| `model` | No | Child model as `provider/id`; defaults to inheriting the current session model. |
| `cwd` | No | Existing directory; defaults to the current cwd. |

The tool supports only TUI and RPC modes because launch may require confirmation.
In JSON and print modes, it fails before creating a group, launcher, or window.
Successful details include `terminalId` and `terminalVersion`.

### `session_bus`

Lists or messages sessions in the active Pi Agent Swarm group.

| Action | Fields | Behavior |
| --- | --- | --- |
| `list` | none | Lists authenticated live peers and request policy. |
| `send` | `targetSessionId`, `message`, optional `mode` | Sends `notify` by default or a permitted one-turn `request`. |
| `reply` | `targetSessionId`, `message`, `replyTo` | Correlates a reply without starting another automatic turn. |
| `shutdown` | `targetSessionId` | Asks a peer to shut down gracefully. |

An accepted acknowledgement means the recipient extension accepted or deduplicated the message, not that the remote agent completed the work.
Rejected and busy acknowledgements use stable codes such as `requests_disabled`, `rate_limited`, `target_busy`, `shutdown_unauthorized`, and `delivery_failed`.
Rate-limited responses may include a bounded retry delay.
Peer-list text and details share a 40 KiB UTF-8 result budget below Pi's tool-output limit.

## 💬 Commands

| Command | Purpose |
| --- | --- |
| `/swarm` | Launch Pi sessions and manage group messaging, peers, invites, and request policy. |
| `/swarm <piagentswarm:v1:invite>` | Review the join confirmation and join one ephemeral local group. |
| `/lead` | Promote a session to leader or inspect the current leader. |
| `/color` | Set the current session's footer color. |

All routes support TUI and RPC, reject unknown or trailing arguments, and fail in print or JSON mode before opening sockets.
Review the [launch flow](#-launch-flow) and [Security and privacy](#-security-and-privacy): accepted peer requests can start paid model turns.

## 🖥️ External terminal backend

Pi Agent Swarm launches each session as a plain terminal window through a configurable command (default `alacritty -e`).
The window manager — any tiling window manager — decides where the window appears.

When `pinToLeadWorkspace` is enabled, Pi Agent Swarm snapshots the window tree before creating the window, locates the lead session's workspace by walking the process tree to the terminal's `_NET_WM_PID`, and moves the new window onto that workspace as soon as it appears.
Placement is best-effort: if the window manager cannot move the window, it stays where it was placed.

## ⚙️ Settings

Open `/swarm` and choose **Settings**.
Pi Agent Swarm stores user settings in `<getAgentDir()>/pi-agent-swarm.json`, normally `~/.pi/agent/pi-agent-swarm.json`:

```json
{
  "externalCommand": "alacritty -e",
  "confirmSessionLaunch": true,
  "pinToLeadWorkspace": false
}
```

| Setting | Values | Default | Behavior |
| --- | --- | --- | --- |
| `externalCommand` | any terminal command | `alacritty -e` | Command used to open each new window. |
| `confirmSessionLaunch` | `true`, `false` | `true` | Shows or skips the final launch preview for menu and tool launches. |
| `pinToLeadWorkspace` | `true`, `false` | `false` | Moves each new window onto the lead session's workspace instead of the focused one. |

Pi Agent Swarm does not read project settings or extension-specific environment-variable overrides.
A missing file uses the defaults without creating the file.
Each Settings change saves immediately.
Writes preserve unknown fields, run in order within one Pi process, and publish atomically through a private temporary file and rename.
The Settings screen reports malformed or invalid files and does not overwrite them.
Separate Pi processes do not share a settings lock, so do not edit this file concurrently from multiple sessions.
A Settings change applies immediately in the current process; other running Pi processes reload it on their next session start or `/reload`.

Group secrets, request permission, peers, readiness state, and deduplication state stay in memory.
The `piagentswarm:v1` prefix versions the bearer-invite encoding separately from the version-3 socket protocol.
Version-3 messages normally expire after two minutes and cannot declare a lifetime longer than five minutes.
Accepted message ids remain deduplicated for ten minutes, longer than their valid delivery window.
A copied invite is still a reusable bearer secret, so discard it or start a new group when you need to rotate access.
A short-lived in-process handoff preserves a group across `/reload` for the same `sessionManager` only.
Membership does not carry into `/new`, `/resume`, or another logical session without a new invite.

The terminal child receives an internal launch-only environment envelope containing a parent-only kickoff capability.
The child consumes and deletes those values during `session_start` before Pi tools can inherit them.
These values are not user settings or supported environment overrides.

Incoming agent requests are blocked by default.
Enabling them permits trusted invite holders to start paid model turns that may edit the same workspace concurrently.

## 🔒 Security and privacy

- Runtime directories are owned by the current user and restricted to `0700`, which is the portable filesystem access boundary.
- Endpoint manifests and Unix sockets are restricted to `0600` as additional platform-specific defense in depth.
- Discovery ignores symlinks, non-regular files, oversized manifests, wrong owners, malformed records, endpoint filename mismatches, and incompatible versions.
- Discovery scans at most 512 directory entries, accepts at most 64 valid manifests, probes at most 16 peers concurrently, and finishes under one overall deadline.
- Invalid manifests do not consume the valid-peer quota, and bounded non-secret diagnostics distinguish saturation, conflicts, protocol failures, deadlines, and unreachable peers.
- Every manifest, request, and response is authenticated for its group and endpoint instance.
  Frames also bind the logical target, claimed sender, clock window, nonce, and request id.
- The shared group MAC proves possession of the bearer invite, not a separate cryptographic identity for each peer.
- A trusted invite holder can claim another session id, so session and endpoint labels are collaboration hints rather than a separate authorization boundary.
- Launch kickoffs also require a random capability shared only through the parent-to-child launch envelope.
  It is not published through peer discovery or persisted with delivered messages.
- Two simultaneously live endpoints claiming one session id are omitted from discovery and rejected as an explicit identity conflict.
- Bearer invites are shown only on the explicit invite screen or direct join input.
- Pi Agent Swarm does not retain invites as durable settings or group state, but a recipient can copy and reuse one until every holder discards it or moves to a new group.
- Invites are not placed in tool output, status, notifications, custom renderers, or model context.
- Launch values briefly exist in a private `0700` launcher that unlinks itself before starting Pi, so terminal command metadata cannot retain them.
- Peer names, paths, messages, model ids, and errors are treated as untrusted terminal text and sanitized only at display boundaries.
- A same-user process or another privileged Pi extension is outside the security boundary and may inspect process arguments, private runtime files, memory, or environment.
- Pi Agent Swarm separates groups but does not sandbox them from the operating-system user.

## 🚧 Limitations

- Local same-user communication only.
- POSIX Unix-socket transport only.
- No LAN, internet, cross-user, remote-host, or public-room transport.
- No daemon, offline mailbox, separate Swarm history, delivery receipt, global ordering, or exactly-once guarantee.
- No automatic trust or discovery of every Pi process.
- No automatic close of a window after partial child startup.
- Protocol version 3 intentionally rejects version-1 and version-2 manifests and frames.
- One request uses one short-lived socket connection; there is no persistent multiplexed channel or delivery stream.
- Server connections use an absolute request deadline rather than an activity-reset timeout, and at most eight message deliveries run concurrently.
- Per-sender and endpoint-wide rate limits are fixed windows, so a busy response can require waiting before retrying.
- Old orphan temporary files, private launchers, and sockets are removed after a grace period.
  Empty private group directories may remain to avoid cross-process startup races.
- No tab, window, resize, focus-navigation, or general layout manager.
- Multiple Pi sessions can still race while editing the same workspace.

## 🗂️ Package layout

```text
packages/pi-agent-swarm/
├── src/                               # Authoritative implementation and helpers
│   ├── index.ts                       # Thin Pi entrypoint
│   ├── pi-agent-swarm.ts              # Local session launch and messaging
│   └── i3-workspace.ts                # Lead-workspace window pinning
├── dist/                              # Generated Jiti runtime
├── scripts/build-runtime.mjs          # Runtime builder
└── test/                              # Behavior and lifecycle coverage
```

The generated runtime is built from `src/index.ts` and does not import back into `src`.

## 🔎 Keywords

Pi extension, Pi Agent Swarm, Pi sessions, external terminal, tiling window manager, local agents, agent communication, Unix socket, TypeScript.

## 📄 License

MIT.
See [`LICENSE`](./LICENSE).
