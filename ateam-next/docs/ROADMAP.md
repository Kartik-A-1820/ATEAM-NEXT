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
- Unit tests for commands, reducer, input editor, and TUI render.

## IN_PROGRESS

- Milestone 1 polished simulated CLI/TUI.
- Manual terminal exercise across simulation scenarios.
- Input hardening for large paste and advanced key combinations.

## NEXT

- Milestone 2 core runtime: cancellation model, lifecycle, error model, effect boundaries.
- Add render throttling and scrollback windowing.
- Add process-control utilities with Windows child-process-tree tests.
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
