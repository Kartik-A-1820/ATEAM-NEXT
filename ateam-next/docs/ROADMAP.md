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
- Add context compiler and provenance-aware memory.
- Add provider-streaming integration for Codex beyond fixture parsing.
- Add render throttling and scrollback windowing.
- Expand process-control utilities with provider fixtures and abort-signal tests.
- Expand simulation tests for rate limit, permission, crash, and cancellation.

## DEFERRED

- SQLite persistence and resume.
- Production Codex adapter.
- Planner and mutable DAG.
- Scheduler.
- Live steering replan/invalidation engine.
- Remaining provider adapters.
- Worktree isolation.
- Single-binary distribution.
