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
      task('T1', `Plan independent workstreams for: ${objective}`, 'analysis', [], 100, ['read_project']),
      task('T2', `Implement core change for: ${objective}`, 'implementation', ['T1'], 80, ['read_project', 'write_project', 'shell']),
      task('T3', `Implement tests and edge coverage for: ${objective}`, 'implementation', ['T1'], 75, ['read_project', 'write_project', 'shell']),
      task('T4', `Implement remaining independent slice for: ${objective}`, 'implementation', ['T1'], 70, ['read_project', 'write_project', 'shell']),
      task('T5', `Independently review implementation for: ${objective}`, 'review', ['T2', 'T3', 'T4'], 60, ['read_project']),
      task('T6', `Run verification and summarize result for: ${objective}`, 'verification', ['T2', 'T3', 'T4'], 90, ['read_project', 'shell']),
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
    tasks: graph.tasks.map(task => shouldInvalidateForConstraint(task) ? {...task, status: 'INVALIDATED'} : task),
  };
}

export function implementationTaskIds(graph: TaskGraph): string[] {
  return graph.tasks.filter(task => task.type === 'implementation').map(task => task.id);
}

export function pipelinePhaseForTask(task: PlannedTask): 'PLAN' | 'IMPLEMENT' | 'VALIDATE' {
  if (task.type === 'review' || task.type === 'verification') return 'VALIDATE';
  if (task.type === 'implementation') return 'IMPLEMENT';
  return 'PLAN';
}

function shouldInvalidateForConstraint(task: PlannedTask): boolean {
  return task.type === 'implementation' && (task.status === 'PENDING' || task.status === 'READY' || task.status === 'RUNNING' || task.status === 'BLOCKED');
}

function task(id: string, objective: string, type: PlannedTask['type'], dependencies: string[], priority: number, requiredCapabilities: Capability[]): PlannedTask {
  return {id, objective, type, dependencies, priority, requiredCapabilities, preferredCapabilities: [], status: 'PENDING'};
}
