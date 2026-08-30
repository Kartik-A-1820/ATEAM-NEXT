import type {AteamEvent} from './events.js';
import {parseStopScope} from './events.js';
import type {AgentId, AgentState, AppState, ConversationEntry, Verbosity} from './types.js';

const agentDefaults: Record<AgentId, AgentState> = {
  codex: {id: 'codex', displayName: 'Codex', color: 'green', availability: 'READY', installed: true, authenticated: 'UNKNOWN', runningTaskCount: 0},
  claude: {id: 'claude', displayName: 'Claude', color: 'yellow', availability: 'READY', installed: true, authenticated: 'UNKNOWN', runningTaskCount: 0},
  agy: {id: 'agy', displayName: 'AGY', color: 'cyan', availability: 'READY', installed: true, authenticated: 'UNKNOWN', runningTaskCount: 0},
  grok: {id: 'grok', displayName: 'Grok', color: 'magenta', availability: 'READY', installed: true, authenticated: 'UNKNOWN', runningTaskCount: 0},
};

export function initialState(width = 100, height = 30): AppState {
  const now = Date.now();
  return {
    sessionId: `sim-${now}`,
    startedAt: now,
    width,
    height,
    activeTab: 'Plan',
    verbosity: 'NORMAL',
    permissionMode: 'STANDARD',
    pipelinePhase: 'IDLE',
    planSummary: undefined,
    agents: structuredClone(agentDefaults),
    conversation: [
      entry('System', 'Simulated Ateam session ready. Type a message or /help.', 'NORMAL'),
    ],
    tasks: {},
    running: false,
    quitting: false,
    log: [],
    openStreams: {},
  };
}

function entry(speaker: ConversationEntry['speaker'], text: string, level: Verbosity, taskId?: string): ConversationEntry {
  return {id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, speaker, text, time: Date.now(), level, ...(taskId === undefined ? {} : {taskId})};
}

function streamKey(agentId: AgentId, taskId?: string): string {
  return `${agentId}:${taskId ?? ''}`;
}

export function reduce(state: AppState, event: AteamEvent): AppState {
  const next: AppState = {...state, agents: {...state.agents}, tasks: {...state.tasks}, conversation: [...state.conversation], log: [...state.log], openStreams: {...(state.openStreams ?? {})}};
  next.log.push(JSON.stringify(event));

  switch (event.type) {
    case 'TerminalResized':
      next.width = event.width;
      next.height = event.height;
      return next;
    case 'UserMessageReceived':
      next.conversation.push(entry('You', event.message, 'QUIET'));
      next.running = true;
      return next;
    case 'UserMessageClassified':
      next.conversation.push(entry('Ateam', `Steering classified as ${event.classification}. Updating active context immediately.`, 'NORMAL'));
      return next;
    case 'AgentAvailabilityChanged': {
      const current = next.agents[event.agentId];
      next.agents[event.agentId] = {...current, availability: event.availability, version: event.version ?? current.version, lastError: event.reason};
      return next;
    }
    case 'AgentStreamDelta': {
      const openStreams = next.openStreams ?? {};
      next.openStreams = openStreams;
      const key = streamKey(event.agentId, event.taskId);
      const openId = openStreams[key];
      const index = openId === undefined ? -1 : next.conversation.findIndex(item => item.id === openId);
      if (index >= 0) {
        const current = next.conversation[index];
        next.conversation[index] = {...current, text: `${current.text}${event.delta}`};
      } else {
        const created = entry(event.agentId, event.delta, 'NORMAL', event.taskId);
        next.conversation.push(created);
        openStreams[key] = created.id;
      }
      return next;
    }
    case 'ThinkingSummary':
      next.conversation.push(entry(event.agentId, `thinking: ${event.summary}`, 'VERBOSE'));
      return next;
    case 'ToolStarted':
      next.conversation.push(entry(event.agentId, `started tool ${event.tool}`, 'VERBOSE'));
      return next;
    case 'ToolFinished':
      next.conversation.push(entry(event.agentId, `finished ${event.tool}: ${event.result}`, 'VERBOSE'));
      return next;
    case 'PermissionRequested':
      next.conversation.push(entry('System', `Permission requested by ${event.agentId}: ${event.capability} (${event.reason})`, 'NORMAL'));
      return next;
    case 'TaskCreated':
      next.tasks[event.taskId] = {id: event.taskId, objective: event.objective, assignedAgent: event.assignedAgent, dependencies: event.dependencies ?? [], status: 'READY', priority: 50, kind: event.kind};
      recomputeAgentWorkload(next);
      next.running = hasActiveTasks(next);
      return next;
    case 'TaskAssigned': {
      const task = next.tasks[event.taskId];
      if (task) {
        next.tasks[event.taskId] = {...task, assignedAgent: event.agentId, attempts: appendAttempt(task.attempts, event.agentId, event.reason, event.at)};
      }
      setCurrentTask(next, event.agentId, event.taskId, task?.objective);
      recomputeAgentWorkload(next);
      next.conversation.push(entry('Ateam', `${event.taskId} assigned to ${event.agentId}: ${event.reason}`, 'VERBOSE'));
      return next;
    }
    case 'TaskReassigned': {
      const task = next.tasks[event.taskId];
      if (task) {
        next.tasks[event.taskId] = {...task, assignedAgent: event.toAgent, attempts: appendAttempt(task.attempts, event.toAgent, event.reason, event.at)};
      }
      if (event.fromAgent) clearCurrentTask(next, event.fromAgent, event.taskId);
      setCurrentTask(next, event.toAgent, event.taskId, task?.objective);
      recomputeAgentWorkload(next);
      next.conversation.push(entry(
        'Ateam',
        `${event.taskId} reassigned${event.fromAgent ? ` from ${event.fromAgent}` : ''} to ${event.toAgent} (attempt ${event.attempt}): ${event.reason}`,
        'NORMAL',
      ));
      return next;
    }
    case 'AgentCooldownChanged': {
      const current = next.agents[event.agentId];
      next.agents[event.agentId] = {...current, cooldownUntil: event.cooldownUntil, cooldownReason: event.cooldownUntil !== undefined ? event.reason : undefined};
      next.conversation.push(entry(
        'System',
        event.cooldownUntil !== undefined
          ? `${current.displayName} cooling down until ${new Date(event.cooldownUntil).toLocaleTimeString()}: ${event.reason}`
          : `${current.displayName} cooldown cleared: ${event.reason}`,
        event.cooldownUntil !== undefined ? 'NORMAL' : 'VERBOSE',
      ));
      return next;
    }
    case 'TaskInvalidated':
      if (next.tasks[event.taskId]) {
        next.tasks[event.taskId] = {...next.tasks[event.taskId], status: 'INVALIDATED'};
      }
      recomputeAgentWorkload(next);
      next.running = hasActiveTasks(next);
      return next;
    case 'TaskStatusChanged': {
      const task = next.tasks[event.taskId];
      if (task) {
        next.tasks[event.taskId] = {...task, status: event.status};
      }
      if (event.status !== 'RUNNING') {
        const openStreams = next.openStreams ?? {};
        next.openStreams = openStreams;
        const suffix = `:${event.taskId}`;
        for (const key of Object.keys(openStreams)) {
          if (key.endsWith(suffix)) delete openStreams[key];
        }
        if (task?.assignedAgent) clearCurrentTask(next, task.assignedAgent, event.taskId);
      }
      recomputeAgentWorkload(next);
      next.running = hasActiveTasks(next);
      return next;
    }
    case 'PlanUpdated':
      next.planSummary = event.summary;
      next.conversation.push(entry('Ateam', event.summary, 'NORMAL'));
      return next;
    case 'ContextUpdated':
      next.conversation.push(entry('System', `Context updated: ${event.summary}`, 'VERBOSE'));
      return next;
    case 'MemoryUpdated':
      next.conversation.push(entry('System', `Memory ${event.memoryId} ${event.verification}: ${event.content}`, 'VERBOSE'));
      return next;
    case 'RateLimited': {
      const current = next.agents[event.agentId];
      next.agents[event.agentId] = {...current, availability: 'RATE_LIMITED', lastError: event.resetHint ?? 'reset unknown'};
      next.conversation.push(entry('System', `${current.displayName} is RATE_LIMITED; reset ${event.resetHint ?? 'UNKNOWN'}.`, 'NORMAL'));
      return next;
    }
    case 'RuntimeError':
      next.conversation.push(entry('System', `Error: ${event.message}`, 'QUIET'));
      return next;
    case 'VerbosityChanged':
      next.verbosity = event.verbosity;
      next.conversation.push(entry('System', `Verbosity set to ${event.verbosity}.`, 'QUIET'));
      return next;
    case 'PermissionModeChanged':
      next.permissionMode = event.mode;
      next.conversation.push(entry('System', `Permission mode set to ${event.mode}.`, 'QUIET'));
      return next;
    case 'StopRequested': {
      const scope = parseStopScope(event.scope);
      for (const task of Object.values(next.tasks)) {
        const cancellable = task.status === 'RUNNING' || task.status === 'READY' || task.status === 'PENDING' || task.status === 'BLOCKED';
        const matches =
          scope.kind === 'all' ||
          scope.kind === 'current' ||
          (scope.kind === 'task' && task.id === scope.taskId) ||
          (scope.kind === 'agent' && task.assignedAgent === scope.agentId);
        if (cancellable && matches) {
          next.tasks[task.id] = {...task, status: 'CANCELLED'};
        }
      }
      if (scope.kind === 'agent') {
        const agent = next.agents[scope.agentId];
        next.agents[scope.agentId] = {...agent, availability: 'READY', runningTaskCount: 0};
      }
      recomputeAgentWorkload(next);
      next.running = hasActiveTasks(next);
      next.conversation.push(entry('System', `Stop requested for ${event.scope}.`, 'QUIET'));
      return next;
    }
    case 'SessionStarted':
      next.sessionId = event.sessionId;
      return next;
    case 'ViewChanged':
      next.activeTab = event.tab;
      return next;
    case 'PipelinePhaseChanged':
      next.pipelinePhase = event.phase;
      next.conversation.push(entry('Ateam', `Pipeline phase: ${event.phase}.`, event.phase === 'IDLE' ? 'VERBOSE' : 'NORMAL'));
      return next;
    case 'ConversationCleared':
      next.conversation = [];
      return next;
    case 'AteamReplied':
      next.conversation.push(entry('Ateam', event.text, 'QUIET'));
      return next;
    case 'ContextPacketCompiled':
      next.conversation.push(entry('System', `Context packet for ${event.taskId} (${event.agentId}):\n${event.packet}`, 'TRACE', event.taskId));
      return next;
    default:
      return next;
  }
}

export function visibleEntries(state: AppState): ConversationEntry[] {
  const rank: Record<Verbosity, number> = {QUIET: 0, NORMAL: 1, VERBOSE: 2, TRACE: 3};
  const max = rank[state.verbosity];
  return state.conversation.filter(item => rank[item.level] <= max);
}

function hasActiveTasks(state: AppState): boolean {
  return Object.values(state.tasks).some(task => task.status === 'RUNNING' || task.status === 'BLOCKED');
}

function appendAttempt(attempts: AppState['tasks'][string]['attempts'], agentId: AgentId, reason: string, at: number): NonNullable<AppState['tasks'][string]['attempts']> {
  return [...(attempts ?? []), {agentId, reason, at}];
}

function setCurrentTask(state: AppState, agentId: AgentId, taskId: string, objective: string | undefined): void {
  const current = state.agents[agentId];
  state.agents[agentId] = {...current, currentTaskId: taskId, currentTaskObjective: objective};
}

function clearCurrentTask(state: AppState, agentId: AgentId, taskId: string): void {
  const current = state.agents[agentId];
  if (current.currentTaskId !== taskId) return;
  state.agents[agentId] = {...current, currentTaskId: undefined, currentTaskObjective: undefined};
}

function recomputeAgentWorkload(state: AppState): void {
  for (const agent of Object.values(state.agents)) {
    agent.runningTaskCount = 0;
  }
  for (const task of Object.values(state.tasks)) {
    if (task.assignedAgent && task.status === 'RUNNING') {
      state.agents[task.assignedAgent].runningTaskCount += 1;
    }
  }
}
