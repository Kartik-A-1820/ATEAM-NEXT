# Contributing to ATEAM-NEXT

Begin with simulation in [README.md](README.md). Discuss large provider/runtime changes before implementation.

1. Fork and create a branch.
2. From `ateam-next/`, use Node.js 24+ and run `npm ci`.
3. Reproduce the issue with a fixture, headless simulation, or a documented terminal sequence.
4. Add focused tests for changed behavior and run `npm run check`.
5. Describe the change, commands/results, environment, and remaining limits in the pull request.

Provider changes should include redacted stdout/stderr fixtures for success and relevant failures. Preserve parser and process-cancellation coverage. Do not require live accounts in ordinary unit tests.

For TUI changes, record OS, shell/terminal, Node version, steps, and observed behavior; include screenshots where useful. Test a failure scenario as well as the happy path.

Use disposable checkouts for live-provider experiments and record exact executable versions. Do not commit credentials, private prompts, provider transcripts, or local databases. Policy primitives do not constitute process isolation.

Useful starting work includes replay tests, cancellation/timeout cases, terminal input fixes, and provider output fixtures. The package declares ISC, but no standalone license text is included; identify third-party terms in proposed additions.
