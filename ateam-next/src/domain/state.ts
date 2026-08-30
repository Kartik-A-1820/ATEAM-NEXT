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
    agents: structuredClone(agentDefaults),
    conversation: [
      entry('System', 'Simulated Ateam session ready. Type a message or /help.', 'NORMAL'),
    ],
    tasks: {},
    running: false,
    quitting: false,
    log: [],
  };
}

function entry(speaker: ConversationEntry['speaker'], text: string, level: Verbosity): ConversationEntry {
  return {id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, speaker, text, time: Date.now(), level};
}

export function reduce(state: AppState, event: AteamEvent): AppState {
  const next: AppState = {...state, agents: {...state.agents}, tasks: {...state.tasks}, conversation: [...state.conversation], log: [...state.log]};
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
      next.agents[event.agentId] = {...current, availability: event.availability, lastError: event.reason};
      return next;
    }
    case 'AgentStreamDelta': {
      const agent = event.agentId;
      const last = next.conversation[next.conversation.length - 1];
      if (last?.speaker === agent) {
        next.conversation[next.conversation.length - 1] = {...last, text: `${last.text}${event.delta}`};
      } else {
        next.conversation.push(entry(agent, event.delta, 'NORMAL'));
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
      next.tasks[event.taskId] = {id: event.taskId, objective: event.objective, assignedAgent: event.assignedAgent, dependencies: event.dependencies ?? [], status: 'READY', priority: 50};
      return next;
    case 'TaskAssigned':
      if (next.tasks[event.taskId]) {
        next.tasks[event.taskId] = {...next.tasks[event.taskId], assignedAgent: event.agentId};
      }
      next.conversation.push(entry('Ateam', `${event.taskId} assigned to ${event.agentId}: ${event.reason}`, 'VERBOSE'));
      return next;
    case 'TaskInvalidated':
      if (next.tasks[event.taskId]) {
        next.tasks[event.taskId] = {...next.tasks[event.taskId], status: 'INVALIDATED'};
      }
      return next;
    case 'TaskStatusChanged':
      if (next.tasks[event.taskId]) {
        next.tasks[event.taskId] = {...next.tasks[event.taskId], status: event.status};
      }
      next.running = Object.values(next.tasks).some(task => task.status === 'RUNNING' || task.status === 'READY');
      return next;
    case 'PlanUpdated':
      next.conversation.push(entry('Ateam', event.summary, 'NORMAL'));
      return next;
    case 'ContextUpdated':
      next.conversation.push(entry('System', `Context updated: ${event.summary}`, 'VERBOSE'));
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
      next.running = Object.values(next.tasks).some(task => task.status === 'RUNNING' || task.status === 'READY' || task.status === 'PENDING');
      next.conversation.push(entry('System', `Stop requested for ${event.scope}.`, 'QUIET'));
      return next;
    }
    case 'SessionStarted':
      next.sessionId = event.sessionId;
      return next;
    case 'ViewChanged':
      next.activeTab = event.tab;
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
