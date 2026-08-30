# Protocol

Ateam uses provider-neutral events. The UI consumes state derived from these events and never parses provider-specific stdout.

## Implemented Events

- `SessionStarted`
- `TerminalResized`
- `UserMessageReceived`
- `UserMessageClassified`
- `AgentAvailabilityChanged`
- `AgentStreamDelta`
- `ThinkingSummary`
- `ToolStarted`
- `ToolFinished`
- `PermissionRequested`
- `TaskCreated`
- `TaskAssigned`
- `TaskStatusChanged`
- `TaskInvalidated`
- `PlanUpdated`
- `ContextUpdated`
- `MemoryUpdated`
- `RateLimited`
- `RuntimeError`
- `VerbosityChanged`
- `PermissionModeChanged`
- `StopRequested`
- `ViewChanged`

Schemas live in `src/domain/events.ts`.

## Provider Adapter Contract

```ts
interface ProviderAdapter {
  id: AgentId;
  probe(): Promise<{availability: AgentAvailability; version?: string; reason?: string}>;
  startSession(send: (event: AteamEvent) => void, signal: AbortSignal): Promise<void>;
  send(message: string): Promise<void>;
  cancel(scope?: string): Promise<void>;
  shutdown(): Promise<void>;
}
```

Adapters may expose optional capabilities later. They must normalize provider-native protocols into this event model and tolerate unknown fields.

## Codex Adapter

The first production adapter target is Codex. Current implementation includes:

- `codex doctor --json` probe scaffolding;
- `codex exec --cd <cwd> --skip-git-repo-check --json -` execution scaffolding;
- JSONL parser fixtures for stream deltas, tools, auth failure, rate limit, malformed lines, and unknown future events.

## State Ownership

Ateam owns:

- canonical session state;
- canonical context;
- permission policy;
- task graph;
- agent availability;
- memory provenance;
- persistence and resume.

Provider sessions are projections or caches, not the source of truth.

## Memory Events

`MemoryUpdated` records provenance-aware knowledge in the canonical stream. It includes:

- stable memory ID;
- category: `FACT`, `HYPOTHESIS`, `DECISION`, `USER_CONSTRAINT`, `AGENT_FINDING`, or `TEST_RESULT`;
- verification: `UNVERIFIED`, `SUPPORTED`, `VERIFIED`, `REJECTED`, or `STALE`;
- optional source agent/task;
- evidence references;
- optional confidence.

SQLite projects these events into the `memories` table for querying, but replaying the event log remains authoritative.

## Context Packets

Context packets are compiled by Ateam, not by provider adapters. A packet contains the task, shared objective summary, current constraints, relevant non-rejected memory, upstream results, acceptance criteria, permission policy, and expected output. Provider adapters translate the packet into provider-specific prompt/protocol fields.

## Cancellation Scope

`StopRequested.scope` currently accepts:

- `all`
- `current`
- `task:<id>`
- `agent:<agentId>`

The reducer cancels matching cancellable tasks and leaves completed work intact.

Cancel-like live user steering emits `StopRequested` immediately, rather than waiting for current tasks to finish.

## Permission Decisions

Ateam owns provider-neutral permission decisions. The current policy supports `SAFE`, `STANDARD`, and `FULL` profiles over capabilities such as `read_project`, `write_project`, `shell`, `network`, `package_install`, `git_commit`, `git_push`, and `destructive_shell`. Explicit denials override profile defaults.
