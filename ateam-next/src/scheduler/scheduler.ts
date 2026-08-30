import type {AgentHealth} from '../domain/agentHealth.js';
import {isOnCooldown} from '../domain/agentHealth.js';
import type {AgentId, AgentState} from '../domain/types.js';
import type {PlannedTask, TaskGraph} from '../planner/taskGraph.js';

export interface Assignment {
  taskId: string;
  agentId: AgentId;
  score: number;
  reason: string;
}

const capabilityBias: Record<AgentId, Partial<Record<PlannedTask['type'], number>>> = {
  grok: {analysis: 25, review: 15},
  claude: {review: 20, analysis: 10},
  codex: {implementation: 20, verification: 10},
  agy: {verification: 20, analysis: 5},
};

export function scheduleTask(task: PlannedTask, agents: Record<AgentId, AgentState>, restrictions: Partial<Record<AgentId, 'review_only' | 'disabled'>> = {}): Assignment | undefined {
  const candidates = Object.values(agents)
    .filter(agent => agent.availability === 'READY')
    .filter(agent => restrictions[agent.id] !== 'disabled')
    .filter(agent => restrictions[agent.id] !== 'review_only' || task.type === 'review')
    .map(agent => scoreAgent(task, agent));

  return candidates.sort((a, b) => b.score - a.score || a.agentId.localeCompare(b.agentId))[0];
}

export function scheduleGraph(graph: TaskGraph, agents: Record<AgentId, AgentState>, restrictions: Partial<Record<AgentId, 'review_only' | 'disabled'>> = {}): Assignment[] {
  const working = structuredClone(agents);
  const assignments: Assignment[] = [];
  for (const task of graph.tasks) {
    const assignment = scheduleTask(task, working, restrictions);
    if (!assignment) continue;
    assignments.push(assignment);
    working[assignment.agentId].runningTaskCount += 1;
  }
  return assignments;
}

/**
 * Just-in-time dispatch: same capability scoring as scheduleTask, but excludes
 * agents currently on a health cooldown (and, optionally, an explicit exclude
 * set for callers that want to avoid re-picking an agent within one pass).
 * Used by the runtime's dispatch loop instead of a fixed plan-time assignment
 * so a rate-limited/unhealthy agent doesn't permanently sink its tasks — once
 * its cooldown elapses it becomes pickable again on its own, which is what
 * lets a single configured agent recover automatically after a rate limit.
 */
export function pickAgentForDispatch(
  task: PlannedTask,
  agents: Record<AgentId, AgentState>,
  health: Partial<Record<AgentId, AgentHealth>>,
  excluding: ReadonlySet<AgentId> = new Set(),
  now = Date.now(),
): Assignment | undefined {
  const restrictions: Partial<Record<AgentId, 'review_only' | 'disabled'>> = {};
  for (const agentId of Object.keys(agents) as AgentId[]) {
    if (excluding.has(agentId) || isOnCooldown(health[agentId], now)) {
      restrictions[agentId] = 'disabled';
    }
  }
  return scheduleTask(task, agents, restrictions);
}

function scoreAgent(task: PlannedTask, agent: AgentState): Assignment {
  const workloadPenalty = agent.runningTaskCount * 25;
  const score = 100 + (capabilityBias[agent.id][task.type] ?? 0) - workloadPenalty;
  return {taskId: task.id, agentId: agent.id, score, reason: `${task.type} score=${score}`};
}
