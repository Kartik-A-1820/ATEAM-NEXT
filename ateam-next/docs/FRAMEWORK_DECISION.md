# Framework Decision

Status: Accepted for Milestone 1

Date: 2026-08-29

## Decision

Ateam Next starts with TypeScript, Ink, React, Commander, and Vitest.

This is a greenfield decision for the scratch implementation in this repository. The original hypothesis was Go + Bubble Tea v2 + Bubbles + Lip Gloss, but the local and technical evidence did not justify selecting a stack that cannot currently build on this Windows machine when Milestone 1 is explicitly about a working simulated interactive terminal.

## Candidates

| Candidate | Fit for Ateam | Decision |
| --- | --- | --- |
| Go + Bubble Tea v2 + Bubbles + Lip Gloss | Strong conceptual fit for event -> update -> state -> view and single-binary distribution. Current local machine has no Go toolchain on PATH. Current docs note Windows resize limitations around SIGWINCH-style reporting. Peer review flagged Windows paste/resize risk. | Rejected for this first scratch build; keep as a future release candidate if Go is installed and Windows input risks are proven manageable. |
| Rust + Ratatui + Crossterm/Tokio | Excellent control over process management, cancellation, performance, and native binaries. High implementation cost and no Rust toolchain on PATH. | Rejected for Milestone 1. |
| TypeScript + Ink | Strong local buildability, React-style state, documented raw input hooks, bracketed paste controls through stdin access, resize hooks, and `ink-testing-library`. Good fit for fast TUI iteration and automation-friendly CLI with Commander. | Selected. |
| Python + Textual | Strong terminal widget model and testing ergonomics. Python exists locally, but packaging/startup/single-binary story is weaker than Node for this scratch project. AGY review recommended Textual primarily because of Bubble Tea Windows concerns. | Rejected for now; viable fallback if Ink input behavior proves inadequate. |

## Evaluation Summary

Scores are 1-5 for this product and this workstation.

| Criterion | Go/Bubble Tea | Rust/Ratatui | TypeScript/Ink | Python/Textual |
| --- | ---: | ---: | ---: | ---: |
| Interactive terminal UX | 4 | 4 | 4 | 5 |
| Multiline input | 4 | 4 | 4 | 5 |
| Paste handling | 3 | 4 | 4 | 4 |
| Unicode | 4 | 4 | 4 | 4 |
| Keyboard handling | 4 | 4 | 4 | 4 |
| Windows support | 3 | 4 | 4 | 4 |
| Terminal resize | 3 | 4 | 4 | 4 |
| Scrolling | 4 | 4 | 3 | 5 |
| Streaming updates | 5 | 5 | 4 | 4 |
| Rendering without flicker | 4 | 4 | 4 | 4 |
| Input active during execution | 4 | 4 | 4 | 4 |
| Subprocess management | 5 | 5 | 4 | 3 |
| Process cancellation | 4 | 5 | 4 | 3 |
| Windows child-process-tree termination | 4 | 5 | 3 | 3 |
| Event-driven architecture | 5 | 4 | 4 | 4 |
| Concurrency | 5 | 5 | 4 | 4 |
| TUI tests without real terminal | 3 | 4 | 5 | 5 |
| Packaging/distribution | 5 | 5 | 3 | 2 |
| Single-binary capability | 5 | 5 | 2 | 2 |
| Startup time | 5 | 5 | 4 | 2 |
| Crash recovery | 4 | 5 | 4 | 4 |
| Maintainability | 4 | 3 | 4 | 4 |
| Ecosystem maturity | 4 | 4 | 4 | 4 |
| Hundreds/thousands of events | 5 | 5 | 4 | 4 |
| Long-running sessions | 5 | 5 | 4 | 4 |

## Evidence

- Local toolchain check found Node `v24.12.0` and Python `3.11.9`; `go`, `rustc`, and `cargo` are not on PATH.
- Current Ink docs expose `useInput`, `useStdin`, raw mode state, bracketed paste mode controls, `useWindowSize`, custom stdin/stdout render options, and `ink-testing-library`.
- Current Bubble Tea docs expose the Model/Update/View architecture and `WindowSizeMsg`; they also note Windows does not support resize reporting via SIGWINCH.
- AGY peer review challenged Go/Bubble Tea and recommended Textual for Milestone 1 because of Windows input/paste/resize risk. The recommendation is useful, but Textual was not selected because Node/Ink gives faster local delivery with acceptable testing and input APIs.
- Claude's initial and retry responses misunderstood the self-contained framework prompt and asked for review material. Grok's initial and retry responses timed out. They were invoked through the orchestrator but their outputs were not treated as evidence.

## Tradeoffs

Ink gives up Go's simple native single-binary story and Rust's precise process control. It wins this milestone because it allows the product to exist now, with real tests, responsive input, simulated streaming, and a clean CLI surface.

The architecture keeps the framework replaceable by isolating UI code from canonical events, runtime state, command parsing, provider adapters, and future persistence.

## Risks

- Ink is React-based and may require careful render throttling for very large event streams.
- Node packaging is weaker than Go/Rust single-binary distribution.
- Windows child-process-tree termination will need explicit implementation and tests when real adapters arrive.
- The initial input editor is custom and must be stress-tested with large paste, combining Unicode, and resize storms.

## Mitigations

- Keep provider output behind canonical Ateam events and reducers.
- Persist TRACE logs to files rather than rendering every event.
- Add render throttling and event windowing before high-volume provider adapters.
- Implement process control behind a Windows-aware adapter utility with fixtures before adding multiple real providers.
- Revisit Go/Bubble Tea or Rust/Ratatui only after Milestone 1 if distribution/process constraints dominate over TUI iteration.
