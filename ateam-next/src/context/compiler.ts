import type {PlannedTask, TaskGraph} from '../planner/taskGraph.js';
import type {PermissionProfile} from '../permissions/policy.js';
import type {MemoryRecord} from '../memory/memory.js';

export interface ContextPacket {
  task: Pick<PlannedTask, 'id' | 'objective' | 'type' | 'requiredCapabilities'>;
  sharedSummary: string;
  userConstraints: string[];
  relevantMemory: MemoryRecord[];
  upstreamResults: string[];
  acceptanceCriteria: string[];
  permissionPolicy: PermissionProfile;
  expectedOutput: string;
}

export function compileContextPacket(input: {
  graph: TaskGraph;
  task: PlannedTask;
  memories: MemoryRecord[];
  permissionPolicy: PermissionProfile;
  upstreamResults?: string[];
}): ContextPacket {
  return {
    task: {
      id: input.task.id,
      objective: input.task.objective,
      type: input.task.type,
      requiredCapabilities: input.task.requiredCapabilities,
    },
    sharedSummary: input.graph.objective,
    userConstraints: input.graph.constraints,
    relevantMemory: input.memories.filter(memory => memory.verification !== 'REJECTED' && memory.verification !== 'STALE'),
    upstreamResults: input.upstreamResults ?? [],
    acceptanceCriteria: input.graph.acceptanceCriteria,
    permissionPolicy: input.permissionPolicy,
    expectedOutput: expectedOutput(input.task.type),
  };
}

function expectedOutput(type: PlannedTask['type']): string {
  if (type === 'analysis') return 'Findings with evidence and uncertainty.';
  if (type === 'implementation') return 'Minimal code changes plus tests.';
  if (type === 'review') return 'Bugs, risks, and required fixes only.';
  return 'Verification commands, results, and residual risk.';
}
