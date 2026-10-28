# ATEAM-NEXT package

Run commands in this directory. See the [repository README](../README.md) for scope and prerequisites.

```bash
npm ci
npm run dev
```

The dev command starts simulation. For a headless check:

```bash
npm run start -- run "Inspect a sample task" --simulate --json
npm run start -- sessions --json
npm run check
```

Choose a scenario with `npm run start -- dev --simulate --scenario TOOL_HEAVY`. Other scenarios include `AUTH_FAILURE`, `RATE_LIMIT`, `CRASH`, `TIMEOUT`, `PERMISSION_REQUEST`, and `MALFORMED_STREAM`.

`npm run start -- resume --json` inspects a stored session; interactive resume currently reopens a simulated TUI. `doctor` and `agents` probe local provider executables. Commands without `--simulate` may invoke live providers; do not substitute them for simulation examples.

Development checks: `npm run build`, `npm run lint`, and `npm test`, or their combined `npm run check` target. See [CONTRIBUTING.md](../CONTRIBUTING.md) for validation and reporting expectations.
