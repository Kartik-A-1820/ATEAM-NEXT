# Ateam Next — Production Architecture Blueprint

## Context

Ateam Next is currently a working prototype: an Ink/React TUI that plans an
objective into a task DAG, assigns tasks to one of four provider CLIs
(Codex/Claude/AGY/Grok), and runs them with real dependency-aware
parallelism. The skeleton is sound — event-sourced state (`domain/events.ts`
+ `domain/state.ts`), SQLite session persistence (`storage/store.ts`), a
capability-scoring scheduler (`scheduler/scheduler.ts`), and per-provider
adapters with existing streaming plumbing (`process/runner.ts`'s
`streamProcess`, per-provider JSONL parsers) — but several pieces stop short
of production behavior:

- **No failover.** A task is bound to one agent at plan time. If that agent
  rate-limits or errors mid-task, the task just fails — even though another
  configured agent could pick it up. `RuntimeController.executeAssignedTask`
  (`runtime/runtime.ts:258`) always resets the agent to `READY` in its
  `finally` block, even after a rate-limit/auth failure, which also
  mis-reports agent health in the UI.
- **No live streaming in real mode.** `runOnce()` on every adapter (e.g.
  `providers/codex/adapter.ts:37`) buffers the entire CLI run and parses it
  only after the process exits. The `streamProcess` callback hooks
  (`onStdout`/`onStderr`) and per-line JSONL parsers already exist but aren't
  wired together — so during a real (non-simulated) run, the TUI shows
  nothing until an agent is completely finished.
- **UI is functional but not polished.** Fixed-symbol status badges, a
  Diff tab that's a hardcoded placeholder, no markdown/diff rendering, no
  per-task progress, no distinction between "agent talking" vs "agent
  thinking" vs "tool running" beyond a dim-color hint.
- **Conversation feed can garble concurrent work.** `AgentStreamDelta`
  handling in `domain/state.ts:60` appends to the conversation feed by
  matching on `speaker` only — if the same agent is mid-stream on two tasks
  in the same wave (parallel dependency-free tasks), or a new message starts
  before a UI re-render settles, deltas can interleave onto the wrong line.
- **Single-agent usage is an implicit case, not a designed one.** It works
  today by accident (unassigned agents become `DISABLED`), but there's no
  explicit single-agent execution mode, and a rate limit on the only
  available agent currently fails the task instead of waiting/resuming.

Decisions already made with the user (via AskUserQuestion) that scope this
plan:
1. **Streaming: true token-level.** Wire real per-provider streaming through
   the existing `streamProcess` + JSONL-parser plumbing instead of faking
   cadence over a buffered result.
2. **Process model: stay embedded in the TUI.** No orchestrator daemon/IPC
   layer. Reliability comes from the existing SQLite event log + resume,
   not from a long-lived background service.

This document is the blueprint: target architecture, concrete file-level
changes, and a phased rollout.

---

## Guiding principles

- **Extend the event-sourced model, don't replace it.** `AteamEvent` +
  `reduce()` already give us full auditability and verbosity filtering.
  New behavior (failover, health, streaming) should show up as new event
  types or fields flowing through the same reducer, not a parallel
  side-channel.
- **Every orchestration decision is user-visible.** "Intelligent" routing
  is worthless if it's a black box — every reassignment, cooldown, and
  degradation must produce a conversation/log entry with its reason,
  gated by the existing `Verbosity` levels.
- **Degrade, don't fail.** Losing an agent (rate limit, crash, not
  installed) should reduce capacity, not correctness. The system must
  behave correctly at N=1 configured agent as a first-class mode, not a
  fallback.
- **Reuse what's already built.** `streamProcess`, the per-provider
  parsers, `PermissionPolicy`, `MemoryStore`, `compileContextPacket`,
  `AteamStore` are all solid — this plan wires and extends them rather
  than introducing parallel mechanisms.

---

## Part A — Reliability & Intelligent Orchestration

### A1. Agent health & cooldown model

New module `src/domain/agentHealth.ts`:

```ts
interface AgentHealth {
  id: AgentId;
  consecutiveFailures: number;
  cooldownUntil?: number;      // epoch ms; agent excluded from scheduling until then
  cooldownReason?: string;
  rollingLatencyMs?: number;   // exponential moving average, for scoring
  rollingSuccessRate?: number; // 0..1 EMA
  lastSeenAt?: number;
}
```

- Fed by existing events: `RateLimited`, `AgentAvailabilityChanged`
  (`AUTH_ERROR`/`UNHEALTHY`), and a new terminal-vs-transient classification
  on task outcomes.
- Backoff schedule for cooldown when the provider gives no reset hint:
  `[60s, 5m, 15m, 60m]` indexed by consecutive-failure count, capped, with
  jitter. If `RateLimited.resetHint` parses to a concrete time, use that
  instead.
- A cooldown expiring doesn't force `READY` — it just makes the agent
  eligible for scheduling again; the next real probe/dispatch attempt
  determines actual state (matches existing `AgentAvailability` enum, no
  new states needed — `COOLDOWN` already exists in `domain/types.ts`).
- Lives inside `RuntimeController` (one instance, in-memory — no need to
  persist across process restarts for v1; see Part G for what does get
  persisted).

### A2. Just-in-time dispatch instead of static assignment

Today: `planAndSchedule()` calls `scheduleGraph()` once and binds every task
to an agent up front (`runtime/runtime.ts:172-207`). Replace the binding
step with a **dispatch loop**:

- Keep `scheduleGraph`/`scoreAgent` (`scheduler/scheduler.ts`) as the
  *preferred-agent* computation, used at plan time only to show the user
  the initial intended routing (`TaskAssigned` reason string) — not as a
  hard binding.
- Add `pickAgentForDispatch(task, agents, health, excluding: Set<AgentId>)`
  in `scheduler.ts`: same capability scoring as `scoreAgent`, but filters
  out agents with `cooldownUntil > now` or in `excluding`, and breaks ties
  using `rollingSuccessRate`/`rollingLatencyMs` from `AgentHealth`.
- `executeRealPlan` (`runtime/runtime.ts:220`) changes from "assignment is
  fixed, run it" to a loop per ready task:
  1. `pickAgentForDispatch` excluding agents already tried for this task.
  2. If an agent is found → dispatch (see A3 for streaming execution).
  3. If none found (all configured agents on cooldown/disabled) → task
     moves to `BLOCKED` with reason `waiting_for_agent`, and the dispatcher
     re-checks it whenever an `AgentAvailabilityChanged`/cooldown-expiry
     tick fires, or on a coarse poll (e.g. every 5s) — this is what makes
     a single rate-limited agent "come back to life" automatically instead
     of failing the run.
- Task failure classification on dispatch outcome:
  - **Transient** (`RateLimited`, `AUTH_ERROR`, `UNHEALTHY`,
    process-timeout/crash) → requeue task as `READY`, add the failed agent
    to that task's `excluding` set, emit `TaskReassigned` (new event, A4).
  - **Terminal** (agent ran and returned a normal failure result, e.g. the
    work itself failed verification) → mark task `FAILED`, do not
    reassign blindly across all agents — surface it to the user/plan
    layer instead (matches how a human lead would treat "I tried and it
    doesn't work" differently from "I couldn't reach the server").
  - Cap total reassignment attempts per task at `min(3, configuredAgents)`
    to avoid infinite loops when every agent is unhealthy.

### A3. Single-agent mode is the same code path, not a special case

Because dispatch is now per-ready-task and JIT, single-agent operation
falls out naturally: with one provider configured, every task's preferred
list has one entry; if it's on cooldown, tasks go `BLOCKED` and resume
automatically when the cooldown clears — no separate code path needed.
`agentStateForProviders` (`runtime/runtime.ts:338`) and `scoreAgent` already
tolerate a single agent; the only fix needed is relaxing `scoreAgent` so a
capability mismatch doesn't return `undefined` when it's the *only*
candidate (best-effort assignment beats no assignment when there's no
alternative).

### A4. New/changed events (`domain/events.ts`)

- `TaskReassigned {taskId, fromAgent, toAgent, reason, attempt}` — replaces
  today's silent re-use of `TaskAssigned` for reassignment so the UI/log
  can distinguish "initial plan" from "recovered from failure" without
  string-matching reasons.
- `AgentCooldownChanged {agentId, cooldownUntil, reason}` — drives the
  Agents-tab countdown (Part E) and log entries, separate from
  `AgentAvailabilityChanged` so a cooldown timer can be shown even while
  availability is still technically `RATE_LIMITED`.
- Fix the existing bug: `executeAssignedTask`'s `finally` block
  (`runtime/runtime.ts:290`) must not unconditionally emit
  `AgentAvailabilityChanged → READY`; on transient failure it should leave
  the cooldown-derived availability (`RATE_LIMITED`/`COOLDOWN`/`UNHEALTHY`)
  in place.

### A5. Differentiated failure handling & clear messaging

Per-provider classification (each adapter/parser distinguishing `RateLimited`
vs `AUTH_ERROR`/`SIGNED_OUT` vs a plain `RuntimeError`, with reset-hint
extraction) turned out solid across all four adapters. The gap was one level
up: the runtime's *decision* treated every transient failure identically —
same exponential backoff, same blind retry — which is wrong for an auth
failure specifically, since waiting never fixes "not signed in."

- `AgentHealth` gained a `cooldownKind: 'RATE_LIMIT' | 'AUTH' | 'UNHEALTHY'`.
  `AUTH` gets a fixed recheck window instead of escalating backoff (waiting
  longer doesn't help); `RATE_LIMIT`/`UNHEALTHY` keep the existing backoff.
- Before dispatching a real task to an agent whose last failure was
  `AUTH`-kind, the runtime calls the adapter's existing `probe()` first
  (cheap, already used at startup) and only proceeds if it now reports
  `READY` — otherwise it re-applies the cooldown and moves on, so a real
  task attempt is never wasted on an agent that's still signed out.
- Cooldown messages are now composed per kind (`"needs you to
  re-authenticate... recheck at 5:52 PM"` vs `"rate limited, cooling down
  until..."`), and escalate explicitly ("failed 3 times in a row — check
  /doctor") once `consecutiveFailures` crosses `PERSISTENT_FAILURE_THRESHOLD`,
  instead of silently retrying forever with no signal that something is
  persistently wrong.
- Fixed a real silent-failure bug found while testing this: `planAndSchedule`
  only added a task to the runtime's dispatch list if an agent was `READY`
  at *plan* time — if none was, the task got a `TaskCreated` event and then
  was simply dropped, never entering the dispatch loop, so the whole plan
  went quietly `IDLE` with no error and no explanation. Every created task
  now enters the dispatch loop regardless of plan-time assignment, so it
  either succeeds once an agent becomes available or fails with a clear,
  per-agent diagnostic (`"No agent available for P-T3 (codex: not
  installed; claude: authentication failed). Run /doctor."`) instead of
  disappearing.
- Thrown exceptions (process crash, spawn failure) are now prefixed with
  agent and task context (`"codex crashed while running P-T2: spawn
  ENOENT"`) instead of a bare error message with no indication of what was
  running or which agent it came from.

---

## Part B — Real streaming execution

**Status: implemented** across all four adapters (Codex + Claude delivered by
a delegated Codex CLI task; AGY + Grok by a delegated Grok CLI task, both run
with full permissions and disjoint file ownership). Verified together:
181 tests pass, clean `build`/`lint`. One deviation from the original spec
below, decided during integration: `runStreaming` returns `Promise<void>`,
not `Promise<{ok, resultText}>` — the success/transient/terminal decision
already lives in `RuntimeController.executeAssignedTask`'s closure over the
streamed events, so a second return-value channel would just duplicate it.
Both AGY and Grok adapters also gained an `AgyProcessIo`/`GrokProcessIo`
injection seam (Grok already had one) for testing incremental emission
without spawning a real process.

### B1. Adapter contract change

Extend `ExecutableProviderAdapter` (`domain/events.ts:72`) with:

```ts
runStreaming(message: string, onEvent: (event: AteamEvent) => void, signal: AbortSignal): Promise<{ok: boolean; resultText: string}>;
```

`runOnce` stays (used by `runtime/headless.ts` and tests where buffered
output is fine); `runStreaming` becomes the path `RuntimeController` uses
for interactive real-mode execution.

### B2. Implementation per adapter (same pattern ×4)

Each adapter (`providers/{codex,claude,agy,grok}/adapter.ts`) already calls
`streamProcess`. Change `runOnce`'s internals into a shared helper used by
both `runOnce` and `runStreaming`:

- Maintain a line buffer across `onStdout` chunks (split on `\n`, keep the
  trailing partial line in the buffer).
- For each complete line, call the existing per-provider parser
  (`parseCodexJsonl`, `parseClaudeOutput`, `parseAgyOutput`,
  `parseGrokOutput`) — these already accept a JSONL string, so calling them
  one line at a time is a direct reuse, not a rewrite.
- `runStreaming` calls `onEvent` for each event as its line arrives.
  `runOnce` keeps collecting into an array and returns it at the end
  (implemented as `runStreaming` with `onEvent = arr.push`, so the buffered
  path becomes a thin wrapper instead of duplicated logic).
- On process exit: flush any remaining buffered partial line (best-effort
  parse), then resolve `{ok: exitCode === 0, resultText}`.

### B3. Runtime wiring

`executeAssignedTask` (`runtime/runtime.ts:258`) switches from
`await provider.runOnce(prompt)` to
`await provider.runStreaming(prompt, event => this.send(eventWithTask(event, ...)), signal)`,
with `signal` coming from a per-task `AbortController` (needed anyway for
A2's reassignment-on-timeout and for `/stop task:<id>`).

---

## Part C — Chat / conversation integrity

Problem: `reduce()` merges `AgentStreamDelta` into the conversation by
matching `speaker` on the last entry only (`domain/state.ts:60-68`), so
concurrent tasks on the same agent, or a delta arriving after a different
event was appended, silently corrupt the transcript.

Fix: key streaming entries by `(agentId, taskId)`, not just `agentId`.

- `ConversationEntry` (`domain/types.ts:36`) gains an optional
  `taskId?: string`.
- `reduce()`'s `AgentStreamDelta` case appends to the entry whose
  `(speaker, taskId)` matches the *most recent open entry for that pair*
  (track open-entry ids in a small `Map<string, entryId>` on `AppState`,
  cleared when the task's `TaskStatusChanged` moves it out of `RUNNING`),
  instead of only checking `conversation[length-1]`.
- This also fixes the multi-wave parallel-task rendering: two tasks
  running concurrently on different agents already work today (different
  `speaker`), but two tasks on the *same* agent in sequence within one
  wave, or a reassignment restarting a stream, will now render as
  distinct entries instead of concatenating onto stale text.
- Session resume (`storage/store.ts` `eventsForSession` + replay through
  `reduce`) needs no schema change — replaying the same event stream
  through the fixed reducer reconstructs the same correct transcript.

---

## Part D — Full verbosity / observability

**Status: attempt history implemented** (`TaskNode.attempts`, populated on
`TaskAssigned`/`TaskReassigned`, shown in the Tasks tab). The TRACE-level
context-packet surfacing and `/usage` latency stats are still open.

The `Verbosity` (`QUIET/NORMAL/VERBOSE/TRACE`) + per-event level tagging in
`reduce()` is the right mechanism; it's just underused. Additions:

- Every new orchestration decision from Part A gets a conversation entry:
  - `TaskReassigned` → `NORMAL` (user should always see failover happen).
  - `AgentCooldownChanged` → `NORMAL` when entering cooldown, `VERBOSE`
    when it clears.
  - Dispatch scoring rationale (why agent X over Y) → `TRACE` only.
- `TRACE` level additionally surfaces the compiled `ContextPacket`
  (`context/compiler.ts`) sent to each provider and raw provider stdout
  lines that don't map to a known event (currently silently dropped by
  `normalizeCodexEvent`-style parsers returning `undefined`) — critical for
  debugging a misbehaving provider CLI without needing `/doctor`.
- `/status` (`runtime.ts:308`) gains per-task attempt history (which
  agents were tried, why they were skipped) instead of just current
  status — this is the "what's happening and why" view the user asked for.
- `/usage` stays honest (no invented quota numbers — already documented
  behavior) but adds observed latency/success-rate per agent from
  `AgentHealth`, since that's real data we now track, not a guess.

---

## Part E — Availability & "what's it doing" indicators (UI)

**Status: implemented** — `AgentState.currentTaskId`/`currentTaskObjective`
and `cooldownUntil`/`cooldownReason` added to `domain/types.ts`, populated
in `domain/state.ts`'s reducer (`TaskAssigned`/`TaskReassigned` set/move the
current-task pointer, `TaskStatusChanged` leaving `RUNNING` clears it,
`AgentCooldownChanged` sets/clears the cooldown fields). `AgentsView.tsx`
shows a second line per agent ("working on: ..." or "cooling down, 4m 12s
left (reason)"), `TasksView.tsx` shows attempt history inline
("attempts: codex (reason) -> claude (reason)"). Header badge richness
(item 3 in the original list below) is not done — the header still uses
the plain status symbol table.

Header (`tui/App.tsx` `Header`, line 224) and the Agents tab
(`MainPane`, line 146) already show per-agent badges; extend them:

- Agents tab: add current task id + short objective snippet next to each
  busy agent (`agent.currentTaskId`/`currentTaskObjective` — new fields on
  `AgentState`, `domain/types.ts:24`, set/cleared via `TaskStatusChanged`
  and `TaskAssigned`/`TaskReassigned` in `reduce()`).
- Agents tab: show cooldown countdown (`cooldownUntil - now`, formatted)
  for agents in `RATE_LIMITED`/`COOLDOWN`, driven by `AgentCooldownChanged`.
- Header badges: replace the static ASCII symbol table
  (`statusSymbol`, line 25) with a richer but still-plain-text set that
  distinguishes "running task N" vs "cooling down (Xm left)" vs
  "unavailable" — still ASCII/ANSI-safe (no emoji dependency, matches
  Claude Code/Codex CLI conventions), just more states rendered.
- Tasks tab: show attempt history inline (`deps=... attempts=2
  (codex✗ rate-limited → claude)`) using the same attempt log from A2/D.

---

## Part F — UI/UX polish pass (reach Claude Code/Codex/Grok-CLI level)

**Status: items 1–3 implemented** (delegated: Codex CLI did the real Diff
tab + first-run empty state; Grok CLI did markdown-lite rendering + tool-call
visual cards, both full-permission, disjoint file ownership, independently
verified — 224 tests pass, build/lint clean). Item 4 was mostly already
covered by an earlier structural refactor that split `App.tsx` into
per-tab view components (`AgentsView.tsx`, `TasksView.tsx`, `LogsView.tsx`,
`ContextView.tsx`, `DiffView.tsx`, `ConversationView.tsx`, `Header.tsx`,
`StatusBar.tsx`), each already taking `height`/`width` props. Item 5
(command palette autocomplete) is **not done** — deliberately deferred
because it would touch `InputBox.tsx`, which the same session round used
for the paste-compaction/image-attachment work (Part K below); doing both
concurrently in the same file risked a conflict, so autocomplete stayed out
of scope this round.

This is the presentation layer built on top of Parts A–E's better data.
Concrete, scoped changes to `tui/`:

1. **Markdown-lite rendering** for agent output text (bold/code
   spans/bullet lists) in the conversation feed — a small formatter, not a
   full markdown engine; mirrors how Claude Code renders assistant text in
   a terminal.
2. **Real Diff tab.** Replace the hardcoded placeholder
   (`App.tsx:193-199`) with actual `git diff` output for the working tree,
   refreshed after each task completes (reuse `process/runner.ts`'s
   `runProcess` to shell out to `git diff --stat` / `git diff`), rendered
   with basic +/- line coloring.
3. **Distinct visual language for thinking vs tool-use vs output** —
   today all three collapse into dim-colored conversation lines
   (`App.tsx:215`). Give tool calls a one-line collapsible summary
   (`⤷ ran <tool>: <result>` style, ASCII arrow) separate from prose
   output, matching the "tool call card" pattern Claude Code/Codex use.
4. **Responsive layout hardening** — `conversationHeight`/`width`
   computation (`App.tsx:130-133`) is already reactive to terminal resize;
   extend the same treatment to the Tasks/Agents/Logs panes (currently
   fixed-height slices) so nothing clips on small terminals.
5. **Command palette polish** — `commands/registry.ts` + `InputBox`
   already support slash commands and history; add inline
   autocomplete/hinting for `/` commands and agent-scope arguments
   (`/stop agent:<tab-completed>`), reusing `commandHelp()`'s existing
   topic metadata rather than a new command catalog.
6. **First-run / zero-agent state** — `doctor/doctor.ts` already checks
   git/storage/commands; surface a friendly first-run screen when
   `probeLocalAgents` finds zero available providers, pointing at
   `/doctor`, instead of the current bare `RuntimeError`
   ("No configured providers are available for execution.").

---

## Part G — Persistence & resume

**Status: implemented** (delegated to Grok CLI, full-permission). Added
`domain/agentHealth.ts`'s `reduceHealthEvents(events)` — a pure replayer
mirroring `RuntimeController.applyCooldown`/`recordAgentSuccess` exactly,
deriving health from `RateLimited`/`AgentAvailabilityChanged` events (skips
`AgentCooldownChanged`, a derived side-effect, not a source of truth).
`storage/session.ts` gained `replaySessionHealth()` alongside the existing
`replaySession()`. `RuntimeController`'s constructor gained an optional
5th `initialHealth` parameter (seeds `this.health`); `cli.tsx`'s `resume`
command and `App.tsx` thread the replayed health through it. Confirms the
"no new table" call — health is fully derived, no schema change needed.
One pre-existing, unrelated bug noted but not fixed: `cli.tsx`'s `resume`
always renders with `simulate={true}` regardless of the original session's
mode.

No schema redesign — `AteamStore` (`storage/store.ts`) already persists
every event, session, task, and memory. Additions:

- Persist `AgentHealth` snapshots (cooldowns, rolling stats) as a new
  small table (or reuse the existing generic event log — cooldown state
  is fully derivable by replaying `RateLimited`/`AgentCooldownChanged`
  events through a health-reducer, so **no new table is strictly needed**;
  prefer deriving over storing to keep one source of truth).
- `ateam resume` (already a CLI command) replays events through `reduce()`
  to rebuild `AppState`; extend it to also replay through the new
  health-reducer so a resumed session immediately knows which agents were
  mid-cooldown, rather than optimistically treating everyone as `READY`.

---

## Part H — Shared knowledge graph context (large codebases, lower token spend)

**Status: v1 implemented** (delegated to Codex CLI, full-permission), with
one deliberate scope reduction from the design below: the graph is
**in-memory only**, rebuilt once per process (on first real task, or via
`/reindex`) — not persisted to SQLite. Cross-session persistence and the
`ignore`-package/`.gitignore` handling are both deferred; the current
implementation uses a small hand-rolled directory-exclusion list instead
(`node_modules`, `.git`, `dist`, `build`, `coverage`, `.next`, `out`,
`.orchestrator`) to avoid adding a new dependency or touching `package.json`
in an unattended background task. New modules: `knowledge/indexer.ts`
(syntactic-only TS Compiler API walk — no `ts.Program`/type-checker, kept
deliberately lightweight), `knowledge/graph.ts` (in-memory `CodeGraphStore`),
`knowledge/query.ts` (`queryRelevantContext` keyword scoring +
`queryRelevantContextSafe`'s `Promise.race` timeout guard, fail-open on a
missing store, a throwing store, or a timeout). Wired into
`context/compiler.ts` (new optional `codeContext` input, backward
compatible when omitted) and `runtime.ts` (background indexing kicked off
non-blocking on first real dispatch; `/reindex` and `/graph` commands).
Verified: task dispatch proceeds normally even before indexing finishes.

Today every task prompt (`renderProviderTaskPrompt`, `runtime/runtime.ts:354`)
only carries the objective, constraints, and upstream task results
(`compileContextPacket`, `context/compiler.ts`). On a large repo, each agent
independently `grep`s/reads files to orient itself — redundant work repeated
per task and per agent, and it's the single biggest token cost driver once
the codebase is bigger than what fits in one glance. The fix is a **local,
structural index of the repo** that all agents' prompts draw from, so
"where is X defined / what calls Y / what does this file export" is
answered from a compact index lookup instead of a fresh full-file read every
time. This is the same role Lexis (this session's own code-search MCP)
plays for me — Ateam needs an equivalent it owns and controls, since
provider CLIs are invoked as subprocesses with a rendered prompt and can't
assume an MCP tool like Lexis is available to them.

### H1. What gets built

New module `src/knowledge/` with a `CodeGraphStore` persisted in the
**same SQLite file `AteamStore` already uses** (`storage/store.ts`) — no
new service, no new storage engine:

- `files(path, contentHash, language, lastIndexedAt)`
- `symbols(id, file, name, kind, signature, startLine, endLine, exported)`
- `references(fromSymbolId, toSymbolId, kind)` — import/call edges, enough
  for "what uses this" and "what does this depend on" without a full
  call-graph engine.

Indexing is pluggable per language via a small `LanguageIndexer` interface
(`parseFile(path, content) → {symbols, references}`), so it starts narrow
and grows:

- **v1 indexer: TypeScript/JS/TSX**, using the TypeScript Compiler API
  (the `typescript` package is already a dependency — see H2 for the one
  packaging change this requires). Covers Ateam's own codebase today and
  any TS/JS project a user points it at.
- **v2 indexer (optional, additive): other languages** via `web-tree-sitter`
  (WASM — deliberately *not* native `tree-sitter` bindings, to avoid
  requiring a C++ build toolchain on the user's machine; see H2).

### H2. Requirements & extra installation

**Required, zero new installs for TS/JS repos:**
- `better-sqlite3` — already a dependency, stores the graph.
- `typescript` — already present, but currently a `devDependency` (build-
  time only). Using its compiler API to index code at *runtime* means it
  must move to `dependencies` in `package.json`. This is the only
  packaging change required to ship v1.
- `ignore` (npm package, pure JS, ~small) — new, small dependency to
  respect `.gitignore` while indexing (skip `node_modules`, build output,
  anything the user already excludes from git). This is the one genuinely
  new dependency for v1.

**Optional, only if the user wants non-TS languages indexed:**
- `web-tree-sitter` + one `.wasm` grammar per additional language
  (e.g. `tree-sitter-python.wasm`). WASM means no native compilation step
  and no platform-specific prebuilt binaries to break on Windows — but the
  `.wasm` grammar files (a few hundred KB each) must be fetched/bundled
  once. This ships disabled by default; `/doctor` reports which languages
  are indexable based on what's present.

**Explicitly out of scope for v1 (flagged, not built):**
- Embedding/vector-based semantic search. It would need either a local
  embedding model (heavy install, e.g. `@xenova/transformers`, meaningful
  disk/CPU cost) or a hosted embedding API (network dependency, API key,
  cost — contradicts the "no new external services" principle this whole
  blueprint follows). v1 relevance ranking is keyword/AST-based (symbol
  and file names vs. task objective text, weighted by recency of edit and
  declared task scope) — zero extra installs, and good enough at the
  "orient an agent to a large repo" granularity this is solving for.
  Revisit only if keyword ranking proves insufficient in practice.
- No daemon, no IPC, no external network calls — consistent with the
  embedded-in-TUI decision already made for the rest of this plan.

### H3. Wiring into the pipeline

- `compileContextPacket` (`context/compiler.ts`) gains a `codeContext`
  field: a size-capped set of relevant symbol signatures + file outlines
  (signatures only, never full bodies — mirrors Lexis's own "compact by
  default" design) resolved via a new `queryRelevantContext(objective,
  task, budgetChars)` against `CodeGraphStore`.
- `renderProviderTaskPrompt` (`runtime/runtime.ts:354`) includes that
  block so an agent starting a task already knows the relevant
  symbols/files instead of spending its own tool calls (and tokens)
  rediscovering them — this is where the token-usage reduction actually
  happens, and it compounds with more tasks/agents on the same repo.
- Indexing runs **once per repo on first use** (background, non-blocking;
  UI shows an "indexing codebase…" status derived from a new
  `KnowledgeGraphIndexed {fileCount, symbolCount, durationMs}` event), then
  **incrementally** after each dispatch wave (Part A) — only re-parsing
  files changed since the last index (via `git status`/mtime+hash check),
  so cost stays bounded regardless of repo size.
- New slash commands: `/reindex` (force full rebuild — mirrors Lexis's own
  `reindex` tool for exactly the same "index looks stale" situation) and
  `/graph` (show index stats: files/symbols indexed, last indexed time) —
  both are `VERBOSE`/`NORMAL`-gated log entries per Part D's verbosity
  model, not silent.
- New `TRACE`-level event `KnowledgeGraphQueryUsed {taskId, symbolsIncluded,
  estimatedTokensSaved}` so the token-saving claim is auditable, not just
  asserted — fits Part D's "every decision is visible" principle.

### H4. Reliability

- **Fail open, always.** If indexing hasn't finished, fails, or the repo
  has no supported language indexer, `queryRelevantContext` returns empty
  and the prompt falls back to exactly today's behavior (constraints +
  upstream results only). A missing/broken graph must never block or fail
  a task — same "degrade, don't fail" principle as Part A's agent
  failover.
- **Bounded, timeout-guarded queries.** Every graph query used during
  prompt compilation has a hard timeout (e.g. 2s); a slow or corrupted
  index falls back rather than stalling task dispatch.
- **Snapshot-per-wave consistency.** Because Part A dispatches multiple
  agents in parallel within a wave, the graph is queried against a
  snapshot taken at the wave's start and only re-indexed *after* the wave
  finishes — avoids reading half-written files while a sibling agent is
  mid-edit in the same wave.
- **Incremental + content-hashed.** Re-indexing is scoped to changed files
  only (hash comparison, not full re-parse), so staleness windows are
  small and re-index cost scales with the size of a change, not the repo.
- **`.gitignore`-aware.** Never indexes `node_modules`, build output, or
  anything the repo already excludes from version control — reduces both
  noise and any chance of indexing secrets that happen to sit in an
  ignored file.
- **Local and offline only.** No network calls, no API keys, no new
  attack surface beyond the file reads Ateam already performs — matters
  since this touches the whole repo, not just files a task explicitly
  names.
- **Explicit escape hatch.** `/reindex` and the `/doctor` check (index DB
  present/writable, `typescript` resolvable) give the user a way to
  recover from a suspected-stale or corrupted index without deleting
  session data, since the graph tables live in the same SQLite file as
  everything else in Part G.

---

## Part I — Request routing: conversation vs. task

Discovered live while running the TUI (not from static reading): a plain
`Hi` sent as the first message ran the **entire** plan → distribute →
implement → validate pipeline against a generic six-task graph
(`createInitialTaskGraph`'s hardcoded `T1..T6` template applied to whatever
text was typed), and produced no actual reply to the greeting — just
pipeline-phase noise and a boilerplate "Plan created for: Hi" line.

Root cause: `classifyMessage()` (`runtime/simulator.ts`) only mattered for
**steering** an already-active plan (`RuntimeController.handle`,
`runtime/runtime.ts` — the classification check was gated behind
`this.active`). The very first message in a session bypassed classification
entirely and always launched the full pipeline, regardless of content.

**Fix:**
- `classifyMessage` gained a `CONVERSATION` category: a conservative,
  greeting-shaped heuristic (`looksConversational`) — short message,
  matches a small set of opener patterns (`hi`, `hello`, `thanks`, `ok`,
  `bye`, etc.). Biased to miss real greetings rather than swallow a real
  task: anything longer or ambiguous still falls through to the existing
  task/steering classifiers, so a missed "hi" just gets planned (harmless),
  while a false positive would silently drop a real request (bad).
- `handle()` checks for `CONVERSATION` **before** the `this.active` gate
  and before ever touching the pipeline — small talk never creates a task
  graph, never changes `pipelinePhase`, and never disturbs a plan that's
  already running.
- New `AteamReplied {text, at}` event carries the reply, rendered at
  `QUIET` verbosity (always visible, like a `You:` message) via a new
  `domain/state.ts` reducer case — distinct from `PlanUpdated`, which means
  "the plan changed," not "here's a chat reply."
- Reply source depends on mode, all fail-open:
  - **Simulate mode**: a fixed, honest canned reply (no fabricated agent
    work).
  - **Real mode, plan idle**: one configured provider (preferring
    grok/claude/agy over codex, so codex stays free for implementation
    work) gets a short, tools-off, no-file-access "just chat" prompt
    (`renderConversationalPrompt`) via its existing `runOnce` — a single
    lightweight call, no task graph, no dependency waves.
  - **Real mode, plan active**: no provider is called at all — replies
    with a fixed "team's still working" message. This isn't just UX
    politeness: calling a provider adapter for chat while it's already
    mid-task would race against its in-flight call, since adapters keep a
    single mutable `AbortController` per instance (`providers/*/adapter.ts`)
    that a concurrent invocation would silently overwrite, corrupting the
    real task's cancellation wiring. Checking `this.active` sidesteps this
    without needing per-agent busy tracking.
  - **Real mode, zero providers**: a fixed reply pointing at `/doctor`,
    replacing what used to be a bare `RuntimeError` for any message at all
    when nothing is configured.

No new dependencies, no schema changes beyond the one event — this is a
routing fix, not a new subsystem.

---

## Part K — Input ergonomics: paste compaction & image attachments

Not in the original blueprint — added mid-session at the user's request,
alongside continuing Part F.

### K1. Long-paste compaction

`src/input/editor.ts`'s `InputEditorState` gained `pastes: Record<string,
string>` (placeholder text → real expansion) and `pasteCounter`. Any
`insertText` call over `PASTE_COMPACT_THRESHOLD` (400 chars) inserts a short
placeholder like `[4,000 chars pasted #1]` instead of the raw text, and
records the mapping. `submit()` expands every placeholder back to its real
text before the message reaches the runtime — the agent always sees the
full content; only the on-screen editor line stays short. Backspace/Delete
treat a placeholder as one atomic unit (checked by exact text match
immediately adjacent to the cursor) instead of eating it character by
character, and remove its mapping when deleted.

### K2. Image attachments

Two paths, both reusing the same placeholder mechanism as K1 (a placeholder
string mapped to an expansion substituted in at submit time — no separate
data structure):
- **Auto-detect**: pasting/typing a string that, after trimming quotes, is
  an existing file path with an image extension (`.png`/`.jpg`/`.jpeg`/
  `.gif`/`.webp`/`.bmp`) becomes `[image attached #1: name.png]`, expanding
  to `(attached image: /abs/path/name.png)` in the submitted text.
- **Clipboard capture**: a new local command, `/paste-image`, intercepted
  directly in `InputBox.tsx` before it ever reaches `parseInput`/the
  runtime (it's a pure editing action, not a domain command). It shells out
  to a platform clipboard tool (`src/input/clipboardImage.ts`:
  PowerShell's `[Windows.Forms.Clipboard]::GetImage()` on Windows,
  `osascript`/`«class PNGf»` on macOS, `xclip`/`wl-paste` on Linux — no new
  npm dependency), saves to a temp PNG, and inserts the same placeholder
  form on success, or a plain inline `[image paste failed: <reason>]` note
  on failure (e.g. nothing on the clipboard, or the platform tool isn't
  installed) — no new event/prop plumbing needed for the failure path,
  it's just literal editable text the user can delete.
- **Deliberately out of scope**: passing images through to providers via a
  structured channel (e.g. Codex's own `-i <file>` flag). The image path is
  embedded as text in the prompt sent to whichever agent runs the task;
  this doesn't require touching `ExecutableProviderAdapter` or any of the
  four adapters again, but it does mean attachment quality depends on the
  agent's own ability to read a file path it's told about, not a first-class
  multimodal attachment. Flagged as a future enhancement, not built now,
  to avoid re-touching all four adapters for a nice-to-have.

---

## Fix-along-the-way (found during this exploration)

- `src/tui/InputBox.tsx:28,42` — current `tsc` build fails
  (`string | undefined` not assignable to `string` from `submit()`'s
  result). Pre-existing, unrelated to this plan's scope, but should be
  fixed as part of Part F's TUI work since it currently blocks `npm run
  build`.

---

## Phased rollout

1. **Phase 1 — Reliability core (Part A + bugfix).** Agent health/cooldown,
   JIT dispatch, reassignment, single-agent path, the `finally`-block
   availability bug. This is the highest-leverage change (directly serves
   "reliable enough for any user, single agent or many").
2. **Phase 2 — Real streaming (Part B) + chat integrity (Part C).** Wire
   `runStreaming` per adapter, fix delta-merging keyed by task. These two
   are coupled: streaming makes the merge bug far more visible, so fixing
   both together avoids shipping a regression.
3. **Phase 3 — Observability (Part D) + availability indicators (Part E).**
   Mostly additive UI/event-surface work once Phase 1–2 produce the richer
   data to display.
4. **Phase 4 — UI/UX polish pass (Part F).** Diff tab, markdown-lite
   rendering, tool-call cards, responsive panes, command palette,
   first-run state.
5. **Phase 5 — Persistence hardening (Part G).** Resume replay through the
   health-reducer; done last since it depends on the health model from
   Phase 1 being finalized.
6. **Phase 6 — Shared knowledge graph (Part H).** Independent of Phases
   1-5 (it only touches `context/compiler.ts`, a new `knowledge/` module,
   and `/reindex`/`/graph` commands), so it can run in parallel with
   Phase 3/4 once resourcing allows. Land the `typescript`-based v1 indexer
   and keyword-ranked context injection first; treat `web-tree-sitter`
   multi-language support as a follow-up, not a blocker.

Each phase should land as its own set of commits with the existing test
suites (`*.test.ts` alongside almost every module — `runtime.test.ts`,
`state.test.ts`, `scheduler.test.ts`, per-provider `parser.test.ts`, etc.)
extended in place, not a separate test pass at the end.

---

## Verification

- Unit tests: extend `runtime/runtime.test.ts` with reassignment scenarios
  (fake provider that fails with `RateLimited` once then succeeds on
  retry; fake provider set where all agents are on cooldown → task goes
  `BLOCKED` then recovers); extend `domain/state.test.ts` for the keyed
  delta-merge fix; add adapter-level tests (`*/adapter.test.ts` already
  exist for agy/grok/codex) asserting `runStreaming` emits events
  incrementally (mock `streamProcess` to deliver chunks over multiple
  ticks and assert `onEvent` fires before process exit).
- `npm run build && npm run lint && npm test` (the existing `check`
  script) must pass at the end of every phase.
- Manual verification via `npx tsx src/cli.tsx dev --simulate --scenario
  RATE_LIMIT` (existing scenario) to confirm cooldown/reassignment UX,
  and `npx tsx src/cli.tsx dev` (real providers) with only one CLI
  installed to confirm single-agent mode doesn't dead-end.
- Knowledge graph (Part H): unit tests for the TS indexer against fixture
  files (assert expected symbols/references extracted), a
  `queryRelevantContext` test asserting it returns `undefined`/empty on an
  unindexed or timed-out store (fail-open behavior), and a
  `compileContextPacket` test asserting prompt size stays under budget
  with a large fixture repo. Manual check: run `/reindex` on this
  repo itself, then `/graph` to confirm file/symbol counts look sane,
  and diff prompt sizes with the feature on vs. off on a multi-task
  objective to confirm the claimed token reduction.
