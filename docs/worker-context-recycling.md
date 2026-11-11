# Worker context recycling and handoff storage

Status: implemented for `session_spawn` workers, including durable handoff, automatic replacement, and interrupted-launch recovery. Management and retention UI remain future work.

## Purpose

Pi Agent Swarm should let a leader assess a task before launch, allow a worker to use its context without turn-by-turn micromanagement, and automatically replace an unfinished worker when its context reaches approximately 50% of the model context window. The successor must receive a concise, durable handoff rather than the old session transcript.

The 50% value is a soft handoff trigger, not a hard context ceiling. A turn that starts at 45% and finishes at 52% must complete normally. If its task is complete, no successor is needed. If work remains, the worker must hand off at a stable boundary instead of being interrupted or continuing to accumulate context indefinitely.

## Definitions

- **Lineage**: one logical long-running objective across one or more worker sessions. Its identifier remains stable across replacements.
- **Generation**: one worker session within a lineage. Generation numbers increase on every replacement, while session IDs remain distinct.
- **Successor**: a new worker with the same project cwd, model, role, task policy, and request permission as its predecessor, unless the user explicitly changes that launch specification.
- **Handoff**: a concise, structured document containing the objective, decisions, progress, verification, remaining work, next action, and references to necessary artifacts.
- **Artifact**: a large supporting file such as a test log or diagnostic report. Artifacts are read on demand and are not copied wholesale into a handoff.
- **Stable boundary**: a lifecycle point such as `agent_settled` where no tool call or model turn is interrupted and session ownership can be revalidated.
- **Current context usage**: the estimated tokens that the next request would carry, relative to the active model's context window. Cumulative input tokens across all requests are not current context usage and must not drive recycling.

## Confirmed policy

1. A leader assesses each assignment as `short`, `long`, or `auto` before launch. The assessment is recorded in lineage reports and helps the leader choose policy; it does not permit an unfinished short task to remain in an overfull session.
2. The default handoff threshold is approximately 50%, configurable as a policy rather than a permanent universal constant.
3. Below the threshold, the worker chooses how to execute its task. The leader does not need to intervene after every turn.
4. Reaching the threshold never aborts the current turn. The current turn's work is retained.
5. At a stable boundary, a completed task reports and finishes without replacement. An unfinished task enters the handoff flow, including an initially short task that unexpectedly reaches the threshold.
6. A handoff turn is allowed to exceed 50% because it uses the predecessor's remaining context to preserve knowledge.
7. The worker reports context and prepares the handoff. The leader schedules continuation and replacement. The extension owns metrics, storage, state transitions, and lifecycle protection. A worker does not spawn its own successor.
8. Automatic replacement requires prior user authorization and a bounded `maxReplacements` value. Reaching that budget pauses automatic replacement and asks the user for a decision.
9. Handoff material belongs in a dedicated project-local hidden directory, not in project documentation, extension discovery, or automatic model context.

An illustrative policy shape is:

```json
{
  "taskProfile": "short | long | auto",
  "maxContextPercent": 50,
  "maxReplacements": 3
}
```

These are the public `session_spawn.contextRecycling` fields. Automatic recycling also requires `allowRequests: true` and a non-empty initial task.

## Leader operating contract

Before launch, the leader records the original objective, task profile, replacement budget, and launch specification. During execution, it inspects context state before assigning more work and when a worker reports. It does not poll continuously or trigger model turns merely to obtain metrics.

A normal report contains the worker's current lineage, generation, model, current context tokens, context window, usage ratio, task profile, lifecycle state, and update time. Metric updates use notifications or queryable extension state at stable boundaries; they do not create paid model turns.

Around 45%, the worker may prepare checkpoint information, but this is not a prohibition on new work. At approximately 50%, the stable-boundary result determines the next state:

```text
WORKING
  ├── task complete → COMPLETED
  └── work remains and context reaches the handoff threshold
        ↓
HANDOFF_PENDING
        ↓ handoff published
HANDOFF_READY
        ↓ successor launch, readiness, handoff readability, and continuation
REPLACING
        ↓ successor working and predecessor shut down
RETIRED
```

While a lineage is in `HANDOFF_PENDING`, `HANDOFF_READY`, or `REPLACING`, ordinary follow-up requests must not start more work. The transport or orchestration layer should distinguish this condition with a stable `context_handoff` result rather than reporting `requests_disabled` or `target_busy`. Only the handoff and replacement protocol may continue.

## Handoff protocol

The worker receives a dedicated handoff turn when its latest tool result did not already supply a complete structured handoff. Publication is retried at a stable boundary at most once; persistent failure freezes the worker and notifies the user instead of creating unbounded handoff turns.

A handoff contains these sections:

```text
Original objective and constraints
Current state
Completed work
Remaining work
Modified files and Git state
Verification performed and its results
Key decisions and their rationale
Current problem or blocker
Exact next action
Required project files and artifact paths
```

The handoff must not contain invites, group secrets, kickoff capabilities, API keys, complete environment dumps, or a raw session transcript. It should use absolute paths when identifying handoff artifacts and user-facing files so the successor does not depend on an ambiguous cwd.

The replacement sequence is:

1. Freeze the predecessor against ordinary work at a stable boundary.
2. Generate and atomically publish the handoff.
3. Validate that the handoff is complete enough to continue and record `HANDOFF_READY` in lineage metadata.
4. Launch the successor with the inherited launch specification, a new session ID, and the next generation number.
5. Give the successor the original objective, exact handoff path, remaining objective, next action, and an instruction not to repeat completed work.
6. Wait for authenticated readiness and verify that the successor can read the handoff.
7. Deliver the continuation through the normal launch or request protocol.
8. Keep the predecessor frozen, shut it down gracefully, and mark it retired. The durable handoff remains available if the successor later fails.

The successor receives only the concise handoff and paths to artifacts it needs. It must not receive the predecessor's full conversation or scan every prior generation by default.

## Project-local storage

Each worker project owns its Swarm handoff storage under:

```text
<project-root>/.pi/agent-swarm/
├── lineages/
│   └── <lineageId>/
│       ├── lineage.json
│       └── generations/
│           ├── 0001-handoff.md
│           ├── 0002-handoff.md
│           └── 0003-handoff.md
└── artifacts/
    └── <lineageId>/
        ├── 0001/
        │   ├── test-output.log
        │   └── diagnostics.json
        └── 0002/
```

The storage root is the worker's project root, not blindly the leader's cwd. A group may contain workers from different projects. The successor receives an absolute handoff path, so identical cwd values are not required for file resolution.

Use framework-generated safe IDs in paths. Worker display names, model IDs, pasted task text, and session text are untrusted and must not become path components. Human-readable labels belong in metadata.

`lineage.json` records at least the schema version, lineage ID, project root, original objective, task profile, launch specification, current generation, lifecycle state, replacement count, replacement budget, current handoff path, and update time. It must not persist bearer invites, group secrets, or kickoff capabilities.

Write files through private temporary files and atomic rename. Publish the handoff before atomically updating the lineage pointer. Use restrictive directory and file permissions consistent with the existing runtime storage policy, while recognizing that project-local files are not a sandbox from same-user processes.

## Context isolation

The extension creates `.pi/agent-swarm/.gitignore` containing `*`, which excludes generated lineage and artifact content from version control and ordinary ignore-aware search without editing the project's root ignore file:

```gitignore
*
```

Do not add individual handoffs to `AGENTS.md`, README files, or automatic Swarm prompt context. Do not place operational artifacts under `.pi/extensions/`. A leader or successor receives an exact current handoff path; other agents read these files only when their task explicitly requires them.

This layout reduces default context pollution and repository noise. It is not an authorization boundary: another same-user agent can still read the files when instructed. Handoff and artifact content must therefore remain minimal and avoid secrets.

Large generated text belongs under `artifacts/`, with only a short summary and exact path in the handoff. Full transcripts are not saved or transferred by default. The leader and successor must not be shown an aggregate directory listing or all historical handoffs as part of ordinary status reporting.

## Retention and management

Active lineages, unfinished handoffs, failed replacements, and the current handoff needed by a successor must never be automatically deleted. Completed lineage history can be pruned by an explicit retention policy based on age or generation count.

Worker shutdown does not imply immediate deletion. The `/swarm` management interface may later expose active lineages, current handoff paths, storage usage, and pruning of completed history without injecting their contents into model context.

## Failure handling

- **Handoff generation fails**: retry within a small bound. If it still fails, retain the predecessor and do not launch a successor with an empty or missing handoff.
- **Successor launch fails**: keep the predecessor frozen and retain its handoff so the leader can retry or ask the user.
- **Continuation delivery fails**: retain the lineage state and durable handoff; do not report the replacement as complete.
- **Predecessor shutdown fails**: keep it frozen, retry owned cleanup, and never resume ordinary assignments to it.
- **Replacement budget is exhausted**: pause the lineage and notify the user instead of creating an unlimited process chain.
- **A turn hangs or is cancelled**: use the existing timeout, cancellation, disposal, and shutdown mechanisms. Context pressure is not a reason to abort a healthy turn.
- **Session replacement or reload occurs during asynchronous work**: revalidate session manager, generation, lineage ownership, and abort signals after every relevant `await` before writing metadata or advancing the state machine.

## Implementation stages

1. **Metrics and policy**: expose current context usage correctly, record launch policy and lineage identity, and teach the leader how to classify tasks without automatic replacement.
2. **Durable handoff**: implement project-local storage, atomic publication, concise handoff generation, artifact references, and isolation rules.
3. **Automatic replacement**: add stable-boundary state transitions, successor launch, continuation delivery, predecessor freezing, and bounded failure recovery.
4. **Management and retention**: add operational inspection and cleanup without making historical handoffs part of normal model context.

Implementation must follow `docs/extension-conventions.md` and, when persistent settings are introduced, `docs/extension-settings.md`. Public tool or command changes require their normal completion, mode, documentation, Changeset, lifecycle, and cancellation coverage.

## Verification requirements

Run `npm run e2e:context-recycling` for the repeatable end-to-end artifact.
It starts isolated Pi RPC processes with a temporary agent directory and project, then writes `report.json`, the generated lineages, handoff files, and captured events to `node_modules/.cache/e2e-context-recycling/<runId>/`.
It asserts generation 1 joins as working, generation 2 without a readable predecessor handoff is rejected without advancing the lineage, and generation 2 with a complete handoff joins as a working successor.

Write failure cases before implementation and use deterministic lifecycle tests during development. Final verification must include a repeatable end-to-end artifact using isolated Pi sessions and temporary project directories.

A live-session run with the real `deepseek-flash` model on 2026-11-11 verified the protocol end to end. It spawned each worker through `session_spawn` with an external terminal, so it consumes model credits and is not part of the regression gate.

- Multi-turn worker: an `allowRequests: true` worker reported `requests allowed` in `session_bus list`, received a follow-up `mode=request` after reporting, rewrote its file within ten seconds, and replied through `session_bus action=reply`.
- Recycling: with `maxContextPercent: 1` and `maxReplacements: 1`, generation 1 published a readable handoff, the leader spawned generation 2, generation 2 executed the recorded `nextAction`, and the lineage ended at `state=completed`, `currentGeneration=2`, `replacementCount=1`, and `retiredThroughGeneration=1` while generation 1 exited.
- Budget boundary: with `maxReplacements: 0`, the lineage became `state=failed` with no successor, the leader received `replacement budget 0 is exhausted`, and a follow-up request returned the `context_handoff` error code instead of `requests_disabled`.
- The handoff body stayed out of the leader's model context; only an explicit file read brought it in.

At minimum, cover:

- a turn that moves from 45% to 52% completes without cancellation;
- a completed task at or above the threshold creates no successor;
- an unfinished task at or above the threshold creates exactly one authorized successor;
- a handoff turn may exceed the threshold;
- current context usage, not cumulative token usage, drives the decision;
- model changes recalculate the ratio against the active context window;
- ordinary requests are rejected during handoff while the handoff protocol remains available;
- handoff publication and lineage updates are atomic and preserve unknown metadata where applicable;
- successor readiness, handoff readability, continuation failure, and predecessor shutdown failure follow the recovery rules;
- replacement budgets stop automatic process creation;
- cancellation, reload, session replacement, and shutdown cannot advance stale lineage state;
- paths cannot escape the project storage root through display names or untrusted text;
- secrets and raw transcripts are absent from generated handoffs;
- normal project search and model context do not automatically include storage contents.

## Non-goals

This design does not guarantee that context can never exceed 50%, interrupt a healthy turn at a token threshold, copy a complete old conversation into a successor, permit unlimited automatic replacements, or make project-local handoff files a security sandbox. It also does not require other agents to read Swarm operational history as part of their ordinary project work.
