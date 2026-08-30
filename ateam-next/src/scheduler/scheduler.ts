import type {AgentId, AgentState} from '../domain/types.js';
import type {PlannedTask} from '../planner/taskGraph.js';

export interface Assignment {
  taskId: string;
  agentId: AgentId;
  score: number;
  reason: string;
}

const capabilityBias: Record<AgentId, Partial<Record<PlannedTask['type'], number>>> = {
  codex: {implementation: 20, verification: 10},
  claude: {review: 20, analysis: 10},
  agy: {verification: 15, analysis: 5},
  grok: {review: 15, analysis: 5},
};

export function scheduleTask(task: PlannedTask, agents: Record<AgentId, AgentState>, restrictions: Partial<Record<AgentId, 'review_only' | 'disabled'>> = {}): Assignment | undefined {
  const candidates = Object.values(agents)
    .filter(agent => agent.availability === 'READY')
    .filter(agent => restrictions[agent.id] !== 'disabled')
    .filter(agent => restrictions[agent.id] !== 'review_only' || task.type === 'review')
    .map(agent => scoreAgent(task, agent));

  return candidates.sort((a, b) => b.score - a.score || a.agentId.localeCompare(b.agentId))[0];
}

function scoreAgent(task: PlannedTask, agent: AgentState): Assignment {
  const workloadPenalty = agent.runningTaskCount * 10;
  const score = 100 + (capabilityBias[agent.id][task.type] ?? 0) - workloadPenalty;
  return {taskId: task.id, agentId: agent.id, score, reason: `${task.type} score=${score}`};
}
