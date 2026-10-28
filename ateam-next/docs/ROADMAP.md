# Current scope and next work

This is an implementation status guide, not a release or production-readiness claim.

## Implemented foundations

- TypeScript/Ink CLI and TUI with canonical events and a reducer.
- Simulated and headless runtime paths, task graph, scheduling, and failure scenarios.
- SQLite session/event storage, projections, and replay.
- Local provider probing and adapters with parser fixtures.
- Context compilation, local memory, code indexing, and permission-policy primitives.
- Tests for runtime/state, providers, process handling, storage, and terminal input.

Provider adapters contain live execution paths. Their presence and fixture coverage do not establish compatibility with every installed provider version or authenticated account.

## Priority work

- Reproducible live-provider integration checks with exact executable versions.
- Consistent effect/permission enforcement and worktree isolation.
- Complete reconstruction of runtime internals on resume.
- Terminal teardown, rendering/scrollback, and large-paste behavior across platforms.
- Cancellation, timeout, rate-limit, and malformed-stream coverage.
- A task-success evaluation using disposable repositories and verifiable final states.
- Packaging and a documented release process.

Simulation, unit tests, manual terminal observations, and live-provider runs should be reported separately. Preserve failure cases when they expose a limitation.
