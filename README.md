# ATEAM-NEXT

An experimental TypeScript terminal for coordinating local coding-agent providers. The implementation uses an event-driven runtime, an Ink interface, task scheduling, and SQLite session persistence.

Start in simulation mode to inspect the interface and runtime behavior without provider accounts. Live-provider adapters exist, but simulation and fixture tests do not establish unattended engineering reliability.

## Try the simulation

Use Node.js 24+ and npm. The locked dependency set includes native `better-sqlite3`; installation may need platform build tools if no compatible prebuilt binary is available.

```bash
git clone https://github.com/Kartik-A-1820/ATEAM-NEXT.git
cd ATEAM-NEXT/ateam-next
npm ci
npm run dev
```

`npm run dev` explicitly starts simulated agents. To inspect structured output instead of the interactive terminal:

```bash
npm run start -- run "Inspect a sample task" --simulate --json
npm run start -- sessions --json
```

Simulation writes local session state but does not invoke live coding providers. An interactive terminal is required for the TUI.

## Implementation to explore

| Area | Source |
| --- | --- |
| Canonical events and state reduction | `ateam-next/src/domain/` |
| Runtime, headless execution, failure simulation | `ateam-next/src/runtime/` |
| Task graph and scheduling | `ateam-next/src/planner/`, `ateam-next/src/scheduler/` |
| Provider adapters and parser fixtures | `ateam-next/src/providers/` |
| Context, memory, and code indexing | `ateam-next/src/context/`, `ateam-next/src/memory/`, `ateam-next/src/knowledge/` |
| SQLite persistence and replay | `ateam-next/src/storage/` |
| Terminal interface and input handling | `ateam-next/src/tui/`, `ateam-next/src/input/` |

[Architecture](ateam-next/docs/ARCHITECTURE.md) · [Current scope and roadmap](ateam-next/docs/ROADMAP.md) · [Package development guide](ateam-next/README.md)

## Validation

From `ateam-next/`:

```bash
npm run check
npm run start -- dev --simulate --scenario RATE_LIMIT
npm run start -- dev --simulate --scenario PERMISSION_REQUEST
```

The check command builds TypeScript, runs ESLint, and runs Vitest. Simulation scenarios cover behavior such as tool activity, rate limits, crashes, and malformed streams. Their outcomes measure the simulator/runtime handling, not real provider availability.

## Live execution and limits

`doctor` and `agents` inspect local provider executables. Commands without `--simulate` can invoke installed, authenticated providers against the current working directory. Read the adapters and permission policy before using live mode; use a disposable checkout for initial experiments.

The permission model is not an OS sandbox, worktree isolation is unfinished, and session replay does not imply that every runtime internal is fully reconstructed. There is no published task-success benchmark comparing this terminal with individual coding tools.

## Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md). Useful contributions include small provider fixtures, process cancellation tests, replay/resume cases, terminal input reproductions, and clear separation of simulation results from live-provider observations.

The package declares ISC in `package.json`, but a standalone license text is absent. Clarify reuse terms with the maintainer.
