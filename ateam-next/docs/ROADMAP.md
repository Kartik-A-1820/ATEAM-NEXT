# Roadmap

## DONE

- Milestone 0 framework spike completed.
- TypeScript + Ink stack selected and documented.
- Scratch project initialized.
- CLI command layer created.
- Canonical event schema and reducer created.
- Slash-command registry created.
- Unicode-aware input editor created.
- Simulated provider runtime created.
- Ink TUI shell created with conversation, agent indicators, tabs, status, and input.
- Detail views for agents, tasks, context, diff, and logs started.
- Headless simulation now executes the simulator and returns canonical events/state.
- Windows-aware process runner foundation added.
- SQLite persistence with migrations, session list, and event replay added.
- Doctor command probes Git and all four provider executables.
- Codex adapter parser fixtures and scaffold added.
- Streaming process runner added for future provider adapters.
- Permission policy, initial task graph, and deterministic scheduler skeletons added.
- Planner/scheduler now emit canonical task creation and assignment events into simulated runtime.
- Context compiler and provenance-aware in-memory memory store added.
- `MemoryUpdated` canonical event added for user constraints and future agent findings.
- SQLite now projects canonical events into queryable messages, tasks, and memories.
- Interactive TUI sessions now persist canonical events and final session status when launched through the CLI.
- `ateam resume` now launches a persisted session back into the TUI; `ateam resume --json` remains structured output.
- Live cancel steering now emits cancellation immediately while simulated work is active.
- Simulated cancellation now marks active tasks cancelled and restores agent availability.
- Reducer now derives agent running task counts from canonical task state.
- Reducer running state now reflects active/blocked execution instead of planned-but-idle tasks.
- Codex adapter doctor normalization distinguishes auth failures from non-blocking terminal/Windows warnings.
- Unit tests for commands, reducer, input editor, runtime, simulator, process runner, headless mode, and TUI render/input.

## IN_PROGRESS

- Milestone 1 polished simulated CLI/TUI.
- Manual terminal exercise across simulation scenarios.
- Input hardening for large paste and advanced key combinations.
- Milestone 2 core runtime boundaries.
- Milestone 5 planner and mutable DAG foundation.
- Milestone 6 deterministic scheduler foundation.
- Milestone 4 persistence foundation.
- Milestone 3 Codex adapter contract foundation.
- Terminal teardown polish: PTY capture still shows a trailing border character after Ctrl+C even though the shell prompt returns.

## NEXT

- Milestone 2 core runtime: lifecycle, error model, effect boundaries.
- Add provider-streaming integration for Codex beyond fixture parsing.
- Add provider health checks to the TUI agent registry at startup.
- Add render throttling and scrollback windowing.
- Expand process-control utilities with provider fixtures and abort-signal tests.
- Expand simulation tests for rate limit, permission, crash, and cancellation.
- Wire context packets into real provider execution.
- Improve resumed runtime reconstruction so memory/task graph internals are restored, not only visible state.

## DEFERRED

- Full production Codex adapter.
- Full planner and mutable DAG revision engine.
- Advanced scheduler priority changes and user provider policies.
- Remaining provider adapters.
- Worktree isolation.
- Single-binary distribution.
