# pi-agent-swarm

## 0.3.0

### Minor Changes

- 863990e: Rename human-started sessions automatically: after the third completed turn, the bootstrap `MANAGER-<id>` name becomes a `MAN-<title>` summary of the session's first user messages. The rename uses a one-shot completion on the current model, retries on later turns if the completion fails, keeps any name you set yourself, and stays silent on failure (recording a session entry for diagnosis). New `autoName` and `autoNameModel` settings control the behavior. Session name changes made outside the extension (for example `/name`) now refresh the roster peer name and the footer badge immediately.

## 0.2.0

### Minor Changes

- 20ea7c5: Degrade the footer roster badge through three width tiers so it never wraps on narrow terminals. FULL keeps the name, full session id, and role; COMPACT truncates a long name with an ellipsis and shows the 8-column id prefix (the same prefix used by `MANAGER-<prefix>` naming and `/lead` matching); MINIMAL shows only the swarm-colored dot and role. The role badge always survives, names and ids are sanitized before rendering, name truncation is cell-aware (no split UTF-8 or CJK characters), and the badge re-renders on terminal resize.
- a4bbc20: Add `pinToLeadWorkspace` so new external terminal windows land on the lead session's i3 workspace instead of the focused one. The lead workspace is located through the process tree and `_NET_WM_PID`, and each newly spawned window is moved there via `i3-msg` after the window manager maps it. Placement is best-effort and never blocks the launch.
- 680e17e: Rebuild the `/swarm` menu from scratch. The inherited `/fleet` menu was removed and replaced item by item with `Spawn` (launch a worker Pi session in an external terminal), `Rename` (rename this session's Pi name and swarm peer description), and `Set color` (pick from the 8-color palette). Menu actions that open dialogs no longer declare a `busyLabel`, which previously wrapped them in a blocking task loader.
- ef4484d: Replace the high-saturation Tailwind roster palette with GitHub Linguist language colors. The default `muted` palette is a low-saturation set whose yellow matches the ROLE badge; a vivid `bright` palette is available through the new `colorPalette` setting in `pi-agent-swarm.json` or live via `/swarm` → **Set theme**. Both palettes share slot order, so a session keeps its hue when switching, and hexes assigned by older versions still resolve to palette names in peer labels. Direct file edits apply on the next session start or `/reload`.

### Patch Changes

- 3c926dc: Keep the group lead record when the lead session reloads. A reload previously removed `lead.json` while the reload handoff only restores group membership, so the rejoined lead and every peer dropped to the WORKER badge until someone ran `/lead` again. Real departures (quit, `/leave`, session replacement) still remove the record, and a lead change made during the reload gap is honored when the session rejoins.

## 0.3.7

### Patch Changes

- 8abd5b7: Keep generated extension runtime graphs inside Pi's Jiti-loaded TypeScript path to avoid duplicate peer-runtime evaluation during startup. Add measured generated runtimes for Context Management, Herdr, and TypeSafe Search.

## 0.3.6

### Patch Changes

- 5333554: Promote the extensions to the stable lifecycle and remove their experimental warnings.
  
  Pi Agent Swarm no longer asks for separate experimental consent before its existing launch and join confirmations.

## 0.3.5

### Patch Changes

- Updated dependencies [40182e5]
  - @narumitw/pi-tui-kit@0.59.0

## 0.3.4

### Patch Changes

- 3346683: Publish generated lazy chunks at the JavaScript paths referenced by each extension runtime so deferred menus and implementations load correctly through Pi's Jiti loader.
- Updated dependencies [b9eba3a]
  - @narumitw/pi-tui-kit@0.58.0

## 0.3.3

### Patch Changes

- Updated dependencies [6574232]
- Updated dependencies [cddc265]
  - @narumitw/pi-tui-kit@0.57.0

## 0.3.2

### Patch Changes

- 30bc076: Load each extension from a generated TypeScript runtime to reduce Jiti package startup work while preserving existing first-use boundaries.

## 0.3.1

### Patch Changes

- Updated dependencies [8bead31]
  - @narumitw/pi-tui-kit@0.56.0

## 0.3.0

### Minor Changes

- 984b554: Select the current tmux, Zellij, or Ghostty context automatically by default while keeping pinned and explicit backend choices strict.

### Patch Changes

- Updated dependencies [3176172]
  - @narumitw/pi-tui-kit@0.55.0

## 0.2.0

### Minor Changes

- ea5423c: Default session spawning to tmux 3.2 or newer, preserve Ghostty and add Zellij 0.44 or newer as configurable backends, and add persistent launch confirmation settings shared by menu and tool launches.

## 0.1.0

### Minor Changes

- de82445: Add an experimental extension that launches authenticated local Pi sessions in Ghostty splits with parent-only kickoff capabilities and supports endpoint-bound, deadline-bounded version-2 Unix-socket messaging.
