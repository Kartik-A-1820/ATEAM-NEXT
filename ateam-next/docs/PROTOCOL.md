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

## Cancellation Scope

`StopRequested.scope` currently accepts:

- `all`
- `current`
- `task:<id>`
- `agent:<agentId>`

The reducer cancels matching cancellable tasks and leaves completed work intact.

## Permission Decisions

Ateam owns provider-neutral permission decisions. The current policy supports `SAFE`, `STANDARD`, and `FULL` profiles over capabilities such as `read_project`, `write_project`, `shell`, `network`, `package_install`, `git_commit`, `git_push`, and `destructive_shell`. Explicit denials override profile defaults.
