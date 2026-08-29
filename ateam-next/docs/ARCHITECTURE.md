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
- Provider adapters: interface defined in `src/domain/events.ts`; production implementations are future work.
- Persistence, planner, task graph, scheduler, permissions, memory, and context compiler: documented protocol boundaries now, implementation begins after the simulated TUI stabilizes.

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
