import type {AgentId} from '../domain/types.js';
import type {AteamEvent} from '../domain/events.js';

export type SimulationScenario =
  | 'FAST'
  | 'SLOW'
  | 'STREAMING'
  | 'TOOL_HEAVY'
  | 'AUTH_FAILURE'
  | 'RATE_LIMIT'
  | 'CRASH'
  | 'TIMEOUT'
  | 'PERMISSION_REQUEST'
  | 'MALFORMED_STREAM';

const agents: AgentId[] = ['codex', 'claude', 'agy', 'grok'];

export class Simulator {
  private timers = new Set<NodeJS.Timeout>();
  private counter = 0;

  constructor(private readonly send: (event: AteamEvent) => void) {}

  run(message: string, scenario: SimulationScenario = 'STREAMING', options: {emitClassification?: boolean; emitPlan?: boolean} = {}): void {
    const at = Date.now();
    if (options.emitClassification !== false) {
      this.send({type: 'UserMessageClassified', classification: classifyMessage(message), at});
    }
    if (options.emitPlan !== false) {
      this.send({type: 'PlanUpdated', summary: 'I found independent workstreams and assigned simulated agents.', at});
    }

    agents.forEach((agent, index) => {
      const taskId = `T${++this.counter}`;
      this.delay(index * 120, () => {
        if (scenario === 'AUTH_FAILURE' && agent === 'agy') {
          this.send({type: 'AgentAvailabilityChanged', agentId: agent, availability: 'AUTH_ERROR', reason: 'simulated auth failure', at: Date.now()});
          return;
        }
        if (scenario === 'RATE_LIMIT' && agent === 'grok') {
          this.send({type: 'RateLimited', agentId: agent, resetHint: undefined, at: Date.now()});
          return;
        }
        this.send({type: 'TaskCreated', taskId, objective: simulatedObjective(agent, message), assignedAgent: agent, at: Date.now()});
        this.send({type: 'AgentAvailabilityChanged', agentId: agent, availability: 'BUSY', at: Date.now()});
        this.send({type: 'TaskStatusChanged', taskId, status: 'RUNNING', at: Date.now()});
        this.stream(agent, taskId, scenario);
      });
    });
  }

  cancel(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    for (const agent of agents) {
      this.send({type: 'AgentAvailabilityChanged', agentId: agent, availability: 'READY', at: Date.now()});
    }
  }

  private stream(agent: AgentId, taskId: string, scenario: SimulationScenario): void {
    const chunks = scenario === 'TOOL_HEAVY'
      ? ['checking workspace ', 'running simulated tool ', 'summarizing findings ', 'done.']
      : ['I am analyzing the request. ', 'A constraint update can still be accepted while I run. ', 'Partial result recorded.'];
    const step = scenario === 'SLOW' ? 650 : 220;

    chunks.forEach((delta, index) => {
      this.delay(step * (index + 1), () => {
        if (scenario === 'CRASH' && index === 1) {
          this.send({type: 'RuntimeError', message: `${agent} simulated process crash`, at: Date.now()});
          this.send({type: 'TaskStatusChanged', taskId, status: 'FAILED', at: Date.now()});
          this.send({type: 'AgentAvailabilityChanged', agentId: agent, availability: 'UNHEALTHY', reason: 'simulated process crash', at: Date.now()});
          return;
        }
        if (scenario === 'PERMISSION_REQUEST' && index === 1) {
          this.send({type: 'PermissionRequested', agentId: agent, capability: 'write_project', reason: 'simulated edit operation', at: Date.now()});
        }
        if (scenario === 'TOOL_HEAVY' && index === 1) {
          this.send({type: 'ToolStarted', agentId: agent, tool: 'simulated-shell', at: Date.now()});
        }
        if (scenario === 'TOOL_HEAVY' && index === 2) {
          this.send({type: 'ToolFinished', agentId: agent, tool: 'simulated-shell', result: 'exit 0', at: Date.now()});
        }
        this.send({type: 'AgentStreamDelta', agentId: agent, taskId, delta, at: Date.now()});
        if (index === chunks.length - 1) {
          this.send({type: 'TaskStatusChanged', taskId, status: 'COMPLETED', at: Date.now()});
          this.send({type: 'AgentAvailabilityChanged', agentId: agent, availability: 'READY', at: Date.now()});
        }
      });
    });
  }

  private delay(ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
  }
}

export function classifyMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('don\'t') || lower.includes('do not')) return 'NEW_CONSTRAINT';
  if (lower.includes('stop') || lower.includes('cancel')) return 'CANCEL_REQUEST';
  if (lower.includes('?')) return 'QUESTION';
  if (lower.includes('prioritize')) return 'PRIORITY_CHANGE';
  return 'ADDITIONAL_TASK';
}

function simulatedObjective(agent: AgentId, message: string): string {
  const short = message.length > 48 ? `${message.slice(0, 45)}...` : message;
  const role: Record<AgentId, string> = {
    codex: 'implement runtime slice',
    claude: 'review context and plan',
    agy: 'exercise terminal UX',
    grok: 'probe failure modes',
  };
  return `${role[agent]} for "${short}"`;
}
