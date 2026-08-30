# Architecture

Ateam owns orchestration. Providers are workers behind adapters; no provider controls the runtime.

## Layers

- CLI command layer: `src/cli.tsx`, powered by Commander.
- TUI: `src/tui`, powered by Ink. It consumes canonical state only.
- Input subsystem: `src/input`, with cursor movement, history, multiline editing, and Unicode-aware edits.
- Command registry: `src/commands`, with slash commands parsed centrally.
- Event protocol: `src/domain/events.ts`, provider-neutral and validated with Zod.
- Application state: `src/domain/state.ts`, deterministic reducer.
- Runtime: `src/runtime`, currently simulation-first.
- Process control: `src/process`, explicit executable/argv spawning with stdout/stderr separation and Windows-aware process-tree termination.
- Persistence: `src/storage`, using SQLite through `better-sqlite3` with migrations and event replay.
- Provider adapters: `src/providers`, starting with Codex JSONL parser fixtures and probe/run scaffolding.
- Permissions: `src/permissions`, canonical SAFE/STANDARD/FULL capability decisions.
- Planner/task graph: `src/planner`, deterministic task DAG skeleton with constraint invalidation.
- Scheduler: `src/scheduler`, deterministic provider selection heuristics.
- Memory and context compiler: `src/memory` tracks provenance-aware knowledge; `src/context` compiles task-scoped context packets.

## Runtime Flow

Input becomes either a slash command or `UserMessageReceived`.

Canonical events flow through:

```text
event -> reducer -> state -> Ink render
command/effect -> canonical event -> reducer -> state
```

Provider stdout is never consumed directly by the UI. Real adapters must normalize output into Ateam events.

## Agent Registry

The initial registry tracks stable identities:

- Codex: green
- Claude: yellow/orange
- AGY: cyan/blue
- Grok: magenta/purple

Every visual state pairs color with text and symbols such as `READY`, `BUSY`, `RATE_LIMITED`, or `AUTH_ERROR`.

## Simulation First

`ateam dev --simulate` drives the TUI through a deterministic fake provider layer. Scenarios include streaming, tool-heavy runs, permission requests, rate limits, auth failure, and crashes.

Simulation exists so terminal behavior can be tested without consuming provider quota.

## Near-Term Boundaries

Milestone 2 should keep business logic outside Ink components. The reducer, command registry, simulator, provider adapters, permissions, and process control must remain testable without a real terminal.

## Process Control

Provider adapters must use explicit executable paths plus argument arrays. Prompts and large payloads should go through stdin where provider CLIs support it. The process runner captures stdout/stderr separately, supports timeout and abort-driven cancellation, hides child windows on Windows, supports streaming callbacks, and uses `taskkill.exe /pid <pid> /t /f` for Windows process trees.

On Windows, command resolution prefers spawnable `.exe`, `.cmd`, and `.bat` entries from `where.exe`; this is required for CLIs such as Claude that install npm command shims.

## Persistence

SQLite is authoritative for sessions and event replay. Current tables include `sessions`, `events`, `messages`, `tasks`, and `memories`. Headless runs and interactive TUI sessions both persist canonical events and can be listed/resumed from the event log.

`appendEvent` also maintains queryable projections for:

- user/Ateam/system messages;
- task creation, assignment, status, and invalidation;
- provenance-aware memories emitted through `MemoryUpdated`.

The event log remains the source of truth. Projection tables exist for fast CLI/TUI queries and can be rebuilt from events if later migrations need it.

## Memory And Context

Memory records are categorized as facts, hypotheses, decisions, user constraints, agent findings, and test results. Every record carries verification state and evidence references so one provider finding cannot silently become project truth.

The context compiler creates provider/task-specific packets containing the task, shared objective summary, current user constraints, relevant non-rejected memory, upstream results, acceptance criteria, and permission policy. Providers receive these packets through adapters; UI and scheduler code do not depend on provider-specific context formats.

## Planner And Scheduler

The first planner is intentionally deterministic. It creates capability-oriented tasks rather than assigning provider names. The scheduler then picks providers from current agent state, task type, workload, and user restrictions. This preserves graceful degradation from four providers to one.

Live user steering currently records new constraints into memory, updates context, invalidates affected implementation work in the active task graph, and handles cancel-like steering as immediate cancellation.
