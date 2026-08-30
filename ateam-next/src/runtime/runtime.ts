import {classifyMessage, Simulator, type SimulationScenario} from './simulator.js';
import {tabForCommand, type AteamEvent, type ExecutableProviderAdapter, type RuntimeCommand} from '../domain/events.js';
import {applyConstraint, createInitialTaskGraph, type PlannedTask, type TaskGraph} from '../planner/taskGraph.js';
import {initialState} from '../domain/state.js';
import {type Assignment, pickAgentForDispatch, scheduleGraph} from '../scheduler/scheduler.js';
import {MemoryStore} from '../memory/memory.js';
import type {AgentAvailability, AgentId, AgentState, PermissionMode, PipelinePhase, Verbosity} from '../domain/types.js';
import {createDefaultProviders, type ProviderMap} from '../providers/registry.js';
import {compileContextPacket} from '../context/compiler.js';
import {buildGraphStore, loadPersistedGraphStore, savePersistedGraphStore, type CodeGraphStore} from '../knowledge/graph.js';
import {indexDirectory} from '../knowledge/indexer.js';
import {queryRelevantContextSafe} from '../knowledge/query.js';
import {formatDoctor, runDoctor} from '../doctor/doctor.js';
import type {AteamStore} from '../storage/store.js';

type KnowledgeStore = Pick<AteamStore, 'loadGraphOutlines' | 'saveGraphOutlines'>;
import {
  type AgentHealth,
  type CooldownKind,
  createAgentHealth,
  isOnCooldown,
  looksLikeUsageLimit,
  parseResetHint,
  PERSISTENT_FAILURE_THRESHOLD,
  recordRunOutcome,
  recordSuccess,
  recordTransientFailure,
} from '../domain/agentHealth.js';

type AssignedWork = {task: PlannedTask; assignment?: Assignment};

type TaskRuntimeState = {
  task: PlannedTask;
  attemptedAgents: Set<AgentId>;
  announcedAgent?: AgentId;
  done?: boolean;
  failed?: boolean;
};

type DispatchOutcome =
  | {kind: 'success'}
  | {kind: 'transient'; reason: string}
  | {kind: 'terminal'; reason: string};

const MAX_DISPATCH_WAIT_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class RuntimeController {
  private simulator?: Simulator;
  private active = false;
  private readonly memories = new MemoryStore();
  private currentGraph?: TaskGraph;
  private readonly providers: ProviderMap;
  private currentRun?: Promise<void>;
  private verbosity: Verbosity = 'NORMAL';
  private permissionMode: PermissionMode = 'STANDARD';
  private pipelinePhase: PipelinePhase = 'IDLE';
  private readonly taskResults = new Map<string, string>();
  private readonly health: Partial<Record<AgentId, AgentHealth>>;
  private knowledgeGraph?: CodeGraphStore;
  private knowledgeGraphFreshlyIndexed = false;
  private knowledgeGraphIndexing?: Promise<void>;
  private readonly knowledgeStore?: KnowledgeStore;
  private currentImages?: string[];

  constructor(
    private readonly send: (event: AteamEvent) => void,
    private readonly simulate: boolean,
    private readonly scenario: SimulationScenario,
    providers?: ProviderMap,
    /** Health reconstructed from a replayed session (see storage/session.ts), so a
     * resumed session knows which agents were mid-cooldown instead of assuming READY. */
    initialHealth?: Partial<Record<AgentId, AgentHealth>>,
    /** Same AteamStore the session persists to — reused to persist/reload the
     * knowledge graph too, so a repeat session doesn't re-scan from scratch. */
    knowledgeStore?: KnowledgeStore,
  ) {
    if (simulate) {
      this.simulator = new Simulator(send);
    }
    this.providers = providers ?? (simulate ? {} : createDefaultProviders());
    this.health = initialHealth ?? {};
    this.knowledgeStore = knowledgeStore;
    if (!simulate) {
      // Fail-open and synchronous (SQLite reads, no network): gives the very first
      // task prompt *something* to work with while a fresh background reindex runs.
      this.knowledgeGraph = loadPersistedGraphStore(knowledgeStore);
    }
  }

  handle(command: RuntimeCommand): void {
    const at = Date.now();
    switch (command.kind) {
      case 'submitUserMessage':
        this.send({type: 'UserMessageReceived', message: command.message, at});
        {
          const classification = classifyMessage(command.message);
          this.send({type: 'UserMessageClassified', classification, at});
          if (classification === 'CONVERSATION') {
            // Small talk never enters the plan/distribute/implement/validate pipeline,
            // active plan or not — it's a reply, not work, and must not disturb
            // whatever the team is already doing.
            this.respondConversationally(command.message, at);
            return;
          }
          if (this.active && classification !== 'ADDITIONAL_TASK') {
            if (classification === 'NEW_CONSTRAINT') {
              const memory = this.memories.add({category: 'USER_CONSTRAINT', content: command.message, verification: 'VERIFIED', evidence: ['live user steering']});
              this.send({
                type: 'MemoryUpdated',
                memoryId: memory.id,
                category: memory.category,
                content: memory.content,
                verification: memory.verification,
                evidence: memory.evidence,
                at,
              });
              this.applyLiveConstraint(command.message, at);
            }
            if (classification === 'CANCEL_REQUEST') {
              this.simulator?.cancel();
              void this.cancelProviders('current');
              this.active = false;
              this.setPhase('IDLE', at);
              this.send({type: 'StopRequested', scope: 'current', at});
            }
            this.send({type: 'ContextUpdated', summary: command.message, at});
            this.send({type: 'PlanUpdated', summary: 'Active plan updated from latest user instruction; obsolete simulated work will be reconsidered.', at});
            return;
          }
        }
        this.currentImages = command.images && command.images.length > 0 ? command.images : undefined;
        if (this.simulator) {
          this.active = true;
          this.planAndSchedule(command.message, at);
          this.setPhase('IMPLEMENT', at);
          this.simulator.run(command.message, this.scenario, {emitClassification: false});
          return;
        }
        if (Object.keys(this.providers).length > 0) {
          this.active = true;
          const assignments = this.planAndSchedule(command.message, at);
          this.currentRun = this.executeRealPlan(command.message, assignments);
          void this.currentRun;
          return;
        }
        this.send({type: 'RuntimeError', message: 'No configured providers are available for execution.', at});
        return;
      case 'setVerbosity':
        this.verbosity = command.verbosity;
        this.send({type: 'VerbosityChanged', verbosity: command.verbosity, at});
        return;
      case 'setPermissionMode':
        this.permissionMode = command.mode;
        this.send({type: 'PermissionModeChanged', mode: command.mode, at});
        return;
      case 'stop':
        this.simulator?.cancel();
        void this.cancelProviders(command.scope);
        this.active = false;
        this.setPhase('IDLE', at);
        this.send({type: 'StopRequested', scope: command.scope, at});
        return;
      case 'slashCommand':
        this.handleSlashCommand(command.name, command.args, at);
        return;
      case 'quit':
        this.simulator?.cancel();
        void this.cancelProviders('shutdown');
        this.active = false;
        this.setPhase('IDLE', at);
        this.send({type: 'StopRequested', scope: 'shutdown', at});
        return;
      default:
        return;
    }
  }

  shutdown(): void {
    this.simulator?.cancel({emitEvents: false});
    void this.cancelProviders('shutdown');
    this.active = false;
  }

  async waitForIdle(): Promise<void> {
    await this.currentRun;
  }

  private handleSlashCommand(name: string, args: string[], at: number): void {
    if (name === 'status') {
      this.send({type: 'ViewChanged', tab: 'Logs', at});
      this.send({type: 'PlanUpdated', summary: this.statusSummary(), at});
      return;
    }
    if (name === 'usage') {
      this.send({type: 'ViewChanged', tab: 'Logs', at});
      this.send({type: 'PlanUpdated', summary: this.usageSummary(), at});
      return;
    }
    if (name === 'memory') {
      this.send({type: 'ViewChanged', tab: 'Context', at});
      this.send({type: 'PlanUpdated', summary: this.memorySummary(), at});
      return;
    }
    if (name === 'doctor') {
      this.send({type: 'ViewChanged', tab: 'Logs', at});
      void runDoctor().then(report => {
        this.send({type: 'PlanUpdated', summary: formatDoctor(report), at: Date.now()});
      }).catch(error => {
        this.send({type: 'RuntimeError', message: error instanceof Error ? error.message : String(error), at: Date.now()});
      });
      return;
    }
    if (name === 'graph') {
      this.send({type: 'ViewChanged', tab: 'Logs', at});
      this.send({type: 'PlanUpdated', summary: this.graphSummary(), at});
      return;
    }
    if (name === 'reindex') {
      this.send({type: 'ViewChanged', tab: 'Logs', at});
      void this.reindexKnowledgeGraph({manual: true});
      return;
    }
    if (name === 'clear') {
      this.send({type: 'ConversationCleared', at});
      this.send({type: 'PlanUpdated', summary: 'Conversation cleared. Session event log is unchanged.', at});
      return;
    }
    if (name === 'resume') {
      this.send({type: 'PlanUpdated', summary: 'Use `ateam resume` to replay a persisted session. In-session work continues unless /stop was requested.', at});
      return;
    }

    const tab = tabForCommand(name);
    if (tab) {
      this.send({type: 'ViewChanged', tab, at});
      this.send({type: 'PlanUpdated', summary: `${tab} view selected.`, at});
      return;
    }
    this.send({type: 'RuntimeError', message: args[0] ? `Unknown command /${args[0]}` : `Unknown command /${name}`, at});
  }

  private planAndSchedule(objective: string, at: number): AssignedWork[] {
    this.ensureKnowledgeGraphIndexing();
    const graph = createInitialTaskGraph(objective);
    this.currentGraph = graph;
    const state = initialState();
    if (!this.simulate) {
      state.agents = agentStateForProviders(state.agents, this.providers);
    }
    this.setPhase('PLAN', at);
    const assignments: AssignedWork[] = [];
    for (const constraint of this.memories.constraints()) {
      this.send({type: 'ContextUpdated', summary: constraint, at});
    }
    this.setPhase('DISTRIBUTE', at);
    const scheduled = new Map(scheduleGraph(graph, state.agents).map(item => [item.taskId, item]));
    for (const task of graph.tasks) {
      this.send({
        type: 'TaskCreated',
        taskId: `P-${task.id}`,
        objective: task.objective,
        dependencies: task.dependencies.map(dep => `P-${dep}`),
        kind: task.type === 'analysis' ? 'analysis' : task.type,
        at,
      });
      const assignment = scheduled.get(task.id);
      // Push every task, even with no plan-time assignment: an agent that isn't
      // READY right now might still become available by the time the dispatch
      // loop actually gets to it (or the loop will explain clearly why not),
      // instead of silently dropping the task with no assignment and no error.
      assignments.push({task, assignment});
      if (assignment) {
        this.send({type: 'TaskAssigned', taskId: `P-${task.id}`, agentId: assignment.agentId, reason: assignment.reason, at});
      }
    }
    this.send({
      type: 'PlanUpdated',
      summary: `Plan created for: ${objective}. Strategy: plan → distribute → implement (parallel) → validate.`,
      at,
    });
    return assignments;
  }

  private respondConversationally(message: string, at: number): void {
    if (this.simulator || this.active) {
      this.send({
        type: 'AteamReplied',
        text: this.active
          ? 'Got it. The team is still working — send a real task, a constraint, or /stop if you want to change course.'
          : 'Hi! This is a simulated session, so I won’t spin up the team for small talk — tell me what you’d like built, fixed, or investigated and I’ll plan it out.',
        at,
      });
      return;
    }
    const provider = this.providers.grok
      ?? this.providers.claude
      ?? this.providers.agy
      ?? Object.values(this.providers).find((entry): entry is ExecutableProviderAdapter => Boolean(entry));
    if (!provider) {
      this.send({
        type: 'AteamReplied',
        text: 'Hi! I don’t have any coding agents configured yet — run /doctor to check setup, then tell me what you’d like the team to work on.',
        at,
      });
      return;
    }
    void provider.runOnce(renderConversationalPrompt(message)).then(events => {
      const reply = events.filter((event): event is Extract<AteamEvent, {type: 'AgentStreamDelta'}> => event.type === 'AgentStreamDelta')
        .map(event => event.delta)
        .join('')
        .trim();
      this.send({type: 'AteamReplied', text: reply || 'Hi! Tell me what you’d like the team to work on.', at: Date.now()});
    }).catch(() => {
      this.send({type: 'AteamReplied', text: 'Hi! (Had trouble reaching an agent just now — tell me what you’d like to work on and I’ll try again.)', at: Date.now()});
    });
  }

  private applyLiveConstraint(constraint: string, at: number): void {
    if (!this.currentGraph) return;
    const previous = new Map(this.currentGraph.tasks.map(task => [task.id, task.status]));
    this.currentGraph = applyConstraint(this.currentGraph, constraint);
    for (const task of this.currentGraph.tasks) {
      if (task.status === 'INVALIDATED' && previous.get(task.id) !== 'INVALIDATED') {
        this.send({type: 'TaskInvalidated', taskId: `P-${task.id}`, reason: constraint, at});
      }
    }
  }

  private async executeRealPlan(objective: string, assignments: AssignedWork[]): Promise<void> {
    const completed = new Set<string>();
    this.taskResults.clear();
    const runtimeTasks: TaskRuntimeState[] = assignments.map(item => ({
      task: item.task,
      attemptedAgents: new Set<AgentId>(),
      announcedAgent: item.assignment?.agentId,
    }));

    while (this.active) {
      const pending = runtimeTasks.filter(item => !item.done);
      if (pending.length === 0) break;

      const ready = pending.filter(item => item.task.dependencies.every(dep => completed.has(dep)));
      if (ready.length === 0) {
        // No pending task has its dependencies satisfied and nothing is in flight: a cyclic or
        // upstream-failed dependency graph. Fail the remainder rather than spinning forever.
        for (const item of pending) {
          item.done = true;
          item.failed = true;
          this.send({type: 'TaskStatusChanged', taskId: `P-${item.task.id}`, status: 'FAILED', at: Date.now()});
        }
        break;
      }

      this.setPhase(phaseForTasks(ready.map(item => item.task)), Date.now());

      // Cooldown alone gates eligibility here (not `attemptedAgents`): once an agent's
      // cooldown clears it must become pickable again, including for its own prior
      // task, so a single configured agent recovers automatically instead of being
      // permanently locked out of the only task it could ever run.
      const snapshot = this.agentSnapshot();
      const dispatchable: Array<{item: TaskRuntimeState; assignment: Assignment}> = [];
      const blocked: TaskRuntimeState[] = [];
      for (const item of ready) {
        const assignment = this.selectDispatchAssignment(item, snapshot);
        if (assignment) {
          dispatchable.push({item, assignment});
          snapshot[assignment.agentId].runningTaskCount += 1;
        } else {
          blocked.push(item);
        }
      }

      for (const item of blocked) {
        this.send({type: 'TaskStatusChanged', taskId: `P-${item.task.id}`, status: 'BLOCKED', at: Date.now()});
      }

      if (dispatchable.length === 0) {
        const now = Date.now();
        const cooldowns = Object.values(this.health)
          .map(entry => entry?.cooldownUntil)
          .filter((value): value is number => value !== undefined && value > now);
        if (cooldowns.length === 0) {
          // Nothing dispatchable and no agent is coming back on its own: genuinely stuck.
          // Say exactly why, per agent, instead of a bare FAILED with no explanation.
          const diagnosis = Object.entries(snapshot)
            .map(([agentId, state]) => `${agentId}: ${describeAvailability(state.availability)}`)
            .join('; ');
          for (const item of blocked) {
            item.done = true;
            item.failed = true;
            this.send({type: 'RuntimeError', message: `No agent available for P-${item.task.id} (${diagnosis}). Run /doctor to check setup.`, at: Date.now()});
            this.send({type: 'TaskStatusChanged', taskId: `P-${item.task.id}`, status: 'FAILED', at: Date.now()});
          }
          continue;
        }
        const waitMs = Math.min(MAX_DISPATCH_WAIT_MS, Math.max(250, Math.min(...cooldowns) - now));
        await sleep(waitMs);
        continue;
      }

      const byAgent = new Map<AgentId, Array<{item: TaskRuntimeState; assignment: Assignment}>>();
      for (const entry of dispatchable) {
        const list = byAgent.get(entry.assignment.agentId) ?? [];
        list.push(entry);
        byAgent.set(entry.assignment.agentId, list);
      }

      await Promise.all([...byAgent.values()].map(async entries => {
        for (const {item, assignment} of entries) {
          if (!this.active) return;
          if (assignment.agentId !== item.announcedAgent) {
            this.send({
              type: 'TaskReassigned',
              taskId: `P-${item.task.id}`,
              fromAgent: item.announcedAgent,
              toAgent: assignment.agentId,
              reason: assignment.reason,
              attempt: item.attemptedAgents.size + 1,
              at: Date.now(),
            });
            item.announcedAgent = assignment.agentId;
          }
          item.attemptedAgents.add(assignment.agentId);
          const outcome = await this.executeAssignedTask(objective, item.task, assignment);
          if (outcome.kind === 'success') {
            item.done = true;
            completed.add(item.task.id);
            if (item.task.type === 'analysis' && planSaysNoFurtherWork(this.taskResults.get(item.task.id) ?? '')) {
              this.skipRemainingWork(runtimeTasks, 'Plan recommended stopping after analysis; no implement/validate workers.');
              return;
            }
          } else if (outcome.kind === 'transient') {
            // Leave item.done unset: the agent is now on cooldown (see applyCooldown), so the
            // next loop tick will naturally skip it and either pick another agent or wait for
            // this same one to recover. Bounded by cooldown backoff, not retried instantly.
          } else {
            item.done = true;
            item.failed = true;
          }
        }
      }));
    }

    this.setPhase('IDLE', Date.now());
    this.active = false;
  }

  private async executeAssignedTask(objective: string, task: PlannedTask, assignment: Assignment): Promise<DispatchOutcome> {
    const provider = this.providers[assignment.agentId];
    const taskId = `P-${task.id}`;
    const at = Date.now();
    if (!provider) {
      this.send({type: 'TaskStatusChanged', taskId, status: 'FAILED', at});
      this.send({type: 'RuntimeError', message: `No provider available for ${assignment.agentId} on ${taskId}.`, at});
      return {kind: 'terminal', reason: 'no provider configured'};
    }

    // An agent that last failed for AUTH reasons doesn't get another real task
    // attempt just because its recheck window elapsed — waiting never fixes
    // "not signed in." Verify cheaply with probe() first; a real runOnce call
    // would just fail identically and waste the attempt.
    if (this.health[assignment.agentId]?.cooldownKind === 'AUTH') {
      const stillBlocked = await this.reverifyAuth(assignment.agentId, provider, taskId);
      if (stillBlocked) return {kind: 'transient', reason: stillBlocked};
    }

    this.send({type: 'AgentAvailabilityChanged', agentId: assignment.agentId, availability: 'BUSY', at});
    this.send({type: 'TaskStatusChanged', taskId, status: 'RUNNING', at});
    const controller = new AbortController();
    const startedAt = Date.now();
    try {
      let transientReason: string | undefined;
      let terminalReason: string | undefined;
      const chunks: string[] = [];
      await provider.runStreaming(
        await this.renderProviderTaskPrompt(objective, task, assignment.agentId, taskId),
        event => {
          const normalized = eventWithTask(event, assignment.agentId, taskId);
          if (normalized.type === 'RateLimited') {
            transientReason = normalized.resetHint ? `rate limited (reset ${normalized.resetHint})` : 'rate limited';
            this.applyCooldown(assignment.agentId, {reason: transientReason, resetHint: normalized.resetHint, kind: 'RATE_LIMIT'});
          }
          if (normalized.type === 'AgentAvailabilityChanged' && (normalized.availability === 'AUTH_ERROR' || normalized.availability === 'SIGNED_OUT' || normalized.availability === 'UNHEALTHY')) {
            const kind: CooldownKind = normalized.availability === 'UNHEALTHY' ? 'UNHEALTHY' : 'AUTH';
            transientReason = normalized.reason ?? describeAvailability(normalized.availability);
            this.applyCooldown(assignment.agentId, {reason: transientReason, kind});
          }
          if (normalized.type === 'RuntimeError' && !transientReason) {
            if (looksLikeUsageLimit(normalized.message)) {
              transientReason = normalized.message;
              this.applyCooldown(assignment.agentId, {reason: transientReason, resetHint: normalized.message, kind: 'RATE_LIMIT'});
              this.send({type: 'RateLimited', agentId: assignment.agentId, resetHint: normalized.message, at: Date.now()});
            } else {
              terminalReason = normalized.message;
            }
          }
          if (normalized.type === 'AgentStreamDelta') chunks.push(normalized.delta);
          this.send(normalized);
        },
        controller.signal,
        this.currentImages,
      );
      if (!transientReason && !terminalReason) {
        this.recordAgentSuccess(assignment.agentId);
        this.recordRunOutcome(assignment.agentId, {success: true, durationMs: Date.now() - startedAt});
        this.taskResults.set(task.id, chunks.join('') || `${task.id} completed`);
        this.send({type: 'TaskStatusChanged', taskId, status: 'COMPLETED', at: Date.now()});
        return {kind: 'success'};
      }
      this.recordRunOutcome(assignment.agentId, {success: false, durationMs: Date.now() - startedAt});
      if (transientReason) {
        return {kind: 'transient', reason: transientReason};
      }
      this.send({type: 'RuntimeError', message: `${assignment.agentId} failed ${taskId}: ${terminalReason}`, at: Date.now()});
      this.send({type: 'TaskStatusChanged', taskId, status: 'FAILED', at: Date.now()});
      return {kind: 'terminal', reason: terminalReason ?? 'unknown failure'};
    } catch (error) {
      this.recordRunOutcome(assignment.agentId, {success: false, durationMs: Date.now() - startedAt});
      const rawMessage = error instanceof Error ? error.message : String(error);
      const message = `${assignment.agentId} crashed while running ${taskId}: ${rawMessage}`;
      this.applyCooldown(assignment.agentId, {reason: message, kind: 'UNHEALTHY'});
      this.send({type: 'AgentAvailabilityChanged', agentId: assignment.agentId, availability: 'UNHEALTHY', reason: rawMessage, at: Date.now()});
      this.send({type: 'RuntimeError', message, at: Date.now()});
      return {kind: 'transient', reason: message};
    } finally {
      if (!isOnCooldown(this.health[assignment.agentId])) {
        this.send({type: 'AgentAvailabilityChanged', agentId: assignment.agentId, availability: 'READY', at: Date.now()});
      }
    }
  }

  /** Cheap re-check before trusting an AUTH-cooled-down agent with a real task.
   * Returns a user-facing message if it's still blocked, or undefined if it's clear to proceed. */
  private async reverifyAuth(agentId: AgentId, provider: ExecutableProviderAdapter, taskId: string): Promise<string | undefined> {
    const probe = await provider.probe().catch(error => ({
      availability: 'UNHEALTHY' as const,
      reason: error instanceof Error ? error.message : String(error),
      version: undefined as string | undefined,
    }));
    this.send({type: 'AgentAvailabilityChanged', agentId, availability: probe.availability, reason: probe.reason, version: probe.version, at: Date.now()});
    if (probe.availability === 'READY') {
      this.recordAgentSuccess(agentId);
      return undefined;
    }
    const reason = probe.reason ?? describeAvailability(probe.availability);
    this.applyCooldown(agentId, {reason: `still needs attention before ${taskId} can run: ${reason}`, kind: 'AUTH'});
    return reason;
  }

  private applyCooldown(agentId: AgentId, options: {reason: string; resetHint?: string; kind: CooldownKind}): void {
    const now = Date.now();
    const current = this.health[agentId] ?? createAgentHealth(agentId);
    const resetAtMs = parseResetHint(options.resetHint, now);
    const updated = recordTransientFailure(current, {resetAtMs, reason: options.reason, kind: options.kind}, now);
    this.health[agentId] = updated;
    if (updated.cooldownUntil === undefined) return;
    const persistent = updated.consecutiveFailures >= PERSISTENT_FAILURE_THRESHOLD;
    const headline = options.kind === 'AUTH'
      ? `needs you to re-authenticate (${options.reason}) — recheck at ${formatClockTime(updated.cooldownUntil)}`
      : `${options.reason}, cooling down until ${formatClockTime(updated.cooldownUntil)}`;
    const reason = persistent
      ? `${headline} — failed ${updated.consecutiveFailures} times in a row; check /doctor if this keeps happening`
      : headline;
    this.send({type: 'AgentCooldownChanged', agentId, cooldownUntil: updated.cooldownUntil, reason, at: now});
  }

  private recordRunOutcome(agentId: AgentId, options: {success: boolean; durationMs: number}): void {
    const current = this.health[agentId] ?? createAgentHealth(agentId);
    this.health[agentId] = recordRunOutcome(current, options);
  }

  private recordAgentSuccess(agentId: AgentId): void {
    const current = this.health[agentId];
    const hadCooldown = current?.cooldownUntil !== undefined;
    this.health[agentId] = recordSuccess(current ?? createAgentHealth(agentId));
    if (hadCooldown) {
      this.send({type: 'AgentCooldownChanged', agentId, cooldownUntil: undefined, reason: 'recovered', at: Date.now()});
    }
  }

  private agentSnapshot(): Record<AgentId, AgentState> {
    return agentStateForProviders(initialState().agents, this.providers);
  }

  private selectDispatchAssignment(item: TaskRuntimeState, snapshot: Record<AgentId, AgentState>): Assignment | undefined {
    const announced = item.announcedAgent;
    if (
      announced
      && snapshot[announced]?.availability === 'READY'
      && !isOnCooldown(this.health[announced])
    ) {
      return {taskId: item.task.id, agentId: announced, score: 0, reason: 'keep planned assignment'};
    }
    return pickAgentForDispatch(item.task, snapshot, this.health);
  }

  private skipRemainingWork(runtimeTasks: TaskRuntimeState[], reason: string): void {
    const at = Date.now();
    for (const item of runtimeTasks) {
      if (item.done) continue;
      item.done = true;
      this.send({type: 'TaskStatusChanged', taskId: `P-${item.task.id}`, status: 'CANCELLED', at});
    }
    this.send({type: 'PlanUpdated', summary: reason, at});
    this.active = false;
  }

  private async cancelProviders(scope: string): Promise<void> {
    const target = scope.startsWith('agent:') ? scope.slice('agent:'.length) : undefined;
    await Promise.all(Object.entries(this.providers).map(async ([agentId, provider]) => {
      if (target && target !== agentId) return;
      await provider?.cancel(scope);
    }));
  }

  private setPhase(phase: PipelinePhase, at: number): void {
    if (this.pipelinePhase === phase) return;
    this.pipelinePhase = phase;
    this.send({type: 'PipelinePhaseChanged', phase, at});
  }

  private statusSummary(): string {
    const graph = this.currentGraph;
    const taskLines = graph
      ? graph.tasks.map(task => `${task.id} ${task.type} ${task.status} deps=${task.dependencies.join(',') || '-'}`).join('\n')
      : 'No active task graph.';
    return [
      'Ateam status',
      `phase=${this.pipelinePhase} running=${this.active ? 'yes' : 'no'} mode=${this.permissionMode} verbosity=${this.verbosity}`,
      `providers=${Object.keys(this.providers).join(',') || (this.simulate ? 'simulated' : 'none')}`,
      taskLines,
    ].join('\n');
  }

  private usageSummary(): string {
    const observed = (Object.keys(this.health) as AgentId[])
      .map(agentId => ({agentId, health: this.health[agentId]}))
      .filter((entry): entry is {agentId: AgentId; health: AgentHealth} => (entry.health?.totalRuns ?? 0) > 0)
      .map(({agentId, health}) => {
        const successRate = Math.round((100 * (health.totalSuccesses ?? 0)) / (health.totalRuns ?? 1));
        const latency = health.rollingLatencyMs !== undefined ? `${(health.rollingLatencyMs / 1000).toFixed(1)}s avg` : 'latency unknown';
        return `${agentId}: ${health.totalRuns} run${health.totalRuns === 1 ? '' : 's'}, ${successRate}% succeeded, ${latency}`;
      });
    return [
      'Usage',
      'Ateam does not invent remaining-quota numbers. Provider CLIs do not expose a reliable quota field.',
      'Availability is tracked from probes and live AgentAvailabilityChanged events.',
      `Configured providers: ${Object.keys(this.providers).join(', ') || (this.simulate ? 'simulated grok,codex,claude,agy' : 'none')}`,
      `Current pipeline phase: ${this.pipelinePhase}`,
      observed.length > 0 ? `Observed this session:\n${observed.join('\n')}` : 'No real task runs observed yet this session.',
    ].join('\n');
  }

  private memorySummary(): string {
    const records = this.memories.list();
    if (records.length === 0) return 'Memory is empty. User constraints and agent findings will appear here with provenance.';
    return records.map(record => `${record.id} ${record.category} ${record.verification}: ${record.content}`).join('\n');
  }

  private graphSummary(): string {
    const stats = this.knowledgeGraph?.stats();
    if (!stats || stats.fileCount === 0) return 'Knowledge graph is not indexed yet.';
    const freshness = this.knowledgeGraphFreshlyIndexed ? 'indexed this session' : 'loaded from a previous session — reindexing in the background';
    return `Knowledge graph ${freshness}: ${stats.fileCount} files, ${stats.symbolCount} symbols.`;
  }

  private ensureKnowledgeGraphIndexing(): void {
    if (this.simulate || this.knowledgeGraphFreshlyIndexed || this.knowledgeGraphIndexing) return;
    void this.reindexKnowledgeGraph({manual: false});
  }

  private async reindexKnowledgeGraph(options: {manual: boolean}): Promise<void> {
    if (this.simulate && !options.manual) return;
    const started = Date.now();
    const run = indexDirectory(process.cwd())
      .then(outlines => {
        const store = buildGraphStore(outlines);
        this.knowledgeGraph = store;
        this.knowledgeGraphFreshlyIndexed = true;
        savePersistedGraphStore(this.knowledgeStore, store);
        const stats = store.stats();
        const at = Date.now();
        this.send({type: 'KnowledgeGraphIndexed', fileCount: stats.fileCount, symbolCount: stats.symbolCount, durationMs: at - started, at});
        if (options.manual) {
          this.send({type: 'PlanUpdated', summary: `Knowledge graph reindexed: ${stats.fileCount} files, ${stats.symbolCount} symbols.`, at});
        }
      })
      .catch(error => {
        if (options.manual) {
          this.send({type: 'PlanUpdated', summary: `Knowledge graph reindex failed open: ${error instanceof Error ? error.message : String(error)}`, at: Date.now()});
        }
      })
      .finally(() => {
        if (this.knowledgeGraphIndexing === run) this.knowledgeGraphIndexing = undefined;
      });
    this.knowledgeGraphIndexing = run;
    await run;
  }

  private async renderProviderTaskPrompt(objective: string, task: PlannedTask, agentId: AgentId, taskId: string): Promise<string> {
    const context = await queryRelevantContextSafe(this.knowledgeGraph, objective);
    const prompt = renderProviderTaskPrompt(objective, task, this.currentGraph, this.memories, this.permissionMode, this.taskResults, context);
    // Gated at the source, not just at display: a compiled prompt can be sizeable,
    // and this is meant as an opt-in debugging aid, not something logged every run.
    if (this.verbosity === 'TRACE') {
      this.send({type: 'ContextPacketCompiled', taskId, agentId, packet: prompt, at: Date.now()});
    }
    return prompt;
  }
}

function planSaysNoFurtherWork(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('stop after t1')
    || lower.includes('do not spawn')
    || lower.includes('do not distribute')
    || lower.includes('no scoped change')
    || lower.includes('recommended pipeline: **stop');
}

function agentStateForProviders(agents: Record<AgentId, AgentState>, providers: ProviderMap): Record<AgentId, AgentState> {
  const next = structuredClone(agents);
  for (const agent of Object.keys(next) as AgentId[]) {
    if (!providers[agent]) {
      next[agent].availability = 'DISABLED';
    }
  }
  return next;
}

function phaseForTasks(tasks: PlannedTask[]): PipelinePhase {
  if (tasks.some(task => task.type === 'review' || task.type === 'verification')) return 'VALIDATE';
  if (tasks.some(task => task.type === 'implementation')) return 'IMPLEMENT';
  return 'PLAN';
}

function renderProviderTaskPrompt(
  objective: string,
  task: PlannedTask,
  graph: TaskGraph | undefined,
  memories: MemoryStore,
  permissionMode: PermissionMode,
  taskResults: Map<string, string>,
  codeContext?: {symbols: string[]; files: string[]},
): string {
  const packet = graph
    ? compileContextPacket({
      graph,
      task,
      memories: memories.list(),
      permissionPolicy: permissionMode,
      upstreamResults: task.dependencies.map(dep => taskResults.get(dep)).filter((value): value is string => Boolean(value)),
      codeContext: codeContext ? {relevantSymbols: codeContext.symbols, relevantFiles: codeContext.files} : undefined,
    })
    : undefined;
  return [
    'You are an Ateam provider worker. Ateam owns orchestration; complete only the assigned task.',
    `Overall objective: ${objective}`,
    `Pipeline strategy: plan, distribute, implement independent work in parallel, then validate.`,
    `Task ${task.id}: ${task.objective}`,
    `Task type: ${task.type}`,
    packet ? `User constraints: ${packet.userConstraints.join(' | ') || 'none'}` : undefined,
    packet ? `Upstream results: ${packet.upstreamResults.join(' | ') || 'none'}` : undefined,
    packet?.codeContext ? `Code context: ${packet.codeContext.join(' ')}` : undefined,
    packet ? `Acceptance criteria: ${packet.acceptanceCriteria.join(' | ')}` : undefined,
    packet ? `Expected output: ${packet.expectedOutput}` : undefined,
    `Permission profile: ${permissionMode}`,
    'Return concise findings, changes, risks, and verification notes.',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function renderConversationalPrompt(message: string): string {
  return [
    'You are Ateam\'s coordinator having a brief, normal conversation with the user.',
    'This is small talk, not a coding task: do not create a plan, do not read or write files, do not use tools.',
    'Reply naturally and briefly, in 1-3 sentences.',
    `User: ${message}`,
  ].join('\n');
}

function describeAvailability(availability: AgentAvailability): string {
  switch (availability) {
    case 'AUTH_ERROR': return 'authentication failed';
    case 'SIGNED_OUT': return 'signed out';
    case 'NOT_INSTALLED': return 'not installed';
    case 'NOT_CONFIGURED': return 'not configured';
    case 'RATE_LIMITED': return 'rate limited';
    case 'COOLDOWN': return 'cooling down';
    case 'UNHEALTHY': return 'unhealthy';
    case 'DISABLED': return 'not configured for this session';
    case 'BUSY': return 'busy with another task';
    default: return availability.toLowerCase();
  }
}

function formatClockTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
}

function eventWithTask(event: AteamEvent, agentId: AgentId, taskId: string): AteamEvent {
  if (event.type === 'AgentStreamDelta') {
    return {...event, agentId, taskId: event.taskId ?? taskId};
  }
  if (event.type === 'ThinkingSummary' || event.type === 'ToolStarted' || event.type === 'ToolFinished' || event.type === 'PermissionRequested' || event.type === 'RateLimited') {
    return {...event, agentId};
  }
  if (event.type === 'AgentAvailabilityChanged') {
    return {...event, agentId};
  }
  return event;
}
