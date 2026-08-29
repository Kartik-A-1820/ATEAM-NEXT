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
- `TaskStatusChanged`
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
