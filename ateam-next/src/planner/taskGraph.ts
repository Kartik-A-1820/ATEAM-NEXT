import type {AgentId, TaskStatus} from '../domain/types.js';
import type {Capability} from '../permissions/policy.js';

export interface PlannedTask {
  id: string;
  objective: string;
  type: 'analysis' | 'implementation' | 'review' | 'verification';
  dependencies: string[];
  priority: number;
  requiredCapabilities: Capability[];
  preferredCapabilities: Capability[];
  status: TaskStatus;
  assignedAgent?: AgentId;
}

export interface TaskGraph {
  objective: string;
  constraints: string[];
  acceptanceCriteria: string[];
  tasks: PlannedTask[];
}

export function createInitialTaskGraph(objective: string, constraints: string[] = []): TaskGraph {
  return {
    objective,
    constraints,
    acceptanceCriteria: ['changes compile', 'tests pass', 'user constraints are preserved'],
    tasks: [
      task('T1', 'Analyze objective and constraints', 'analysis', [], 100, ['read_project']),
      task('T2', 'Implement minimal safe change', 'implementation', ['T1'], 80, ['read_project', 'write_project', 'shell']),
      task('T3', 'Independently review implementation', 'review', ['T2'], 70, ['read_project']),
      task('T4', 'Run verification and summarize result', 'verification', ['T2'], 90, ['read_project', 'shell']),
    ],
  };
}

export function readyTasks(graph: TaskGraph): PlannedTask[] {
  const complete = new Set(graph.tasks.filter(task => task.status === 'COMPLETED').map(task => task.id));
  return graph.tasks
    .filter(task => task.status === 'PENDING' && task.dependencies.every(dep => complete.has(dep)))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

export function applyConstraint(graph: TaskGraph, constraint: string): TaskGraph {
  return {
    ...graph,
    constraints: [...graph.constraints, constraint],
    tasks: graph.tasks.map(task => task.status === 'RUNNING' && task.type === 'implementation' ? {...task, status: 'INVALIDATED'} : task),
  };
}

function task(id: string, objective: string, type: PlannedTask['type'], dependencies: string[], priority: number, requiredCapabilities: Capability[]): PlannedTask {
  return {id, objective, type, dependencies, priority, requiredCapabilities, preferredCapabilities: [], status: 'PENDING'};
}
