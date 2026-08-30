import type {PlannedTask, TaskGraph} from '../planner/taskGraph.js';
import type {PermissionProfile} from '../permissions/policy.js';
import type {MemoryRecord} from '../memory/memory.js';

export interface ContextPacket {
  task: Pick<PlannedTask, 'id' | 'objective' | 'type' | 'requiredCapabilities'>;
  sharedSummary: string;
  userConstraints: string[];
  relevantMemory: MemoryRecord[];
  upstreamResults: string[];
  codeContext?: string[];
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
  codeContext?: {relevantSymbols: string[]; relevantFiles: string[]};
}): ContextPacket {
  const codeContext = formatCodeContext(input.codeContext);
  const packet: ContextPacket = {
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
  if (codeContext.length > 0) packet.codeContext = codeContext;
  return packet;
}

function formatCodeContext(context: {relevantSymbols: string[]; relevantFiles: string[]} | undefined): string[] {
  if (!context || (context.relevantSymbols.length === 0 && context.relevantFiles.length === 0)) return [];
  return [
    context.relevantSymbols.length > 0 ? `Relevant symbols: ${context.relevantSymbols.join(' | ')}` : undefined,
    context.relevantFiles.length > 0 ? `Relevant files: ${context.relevantFiles.join(' | ')}` : undefined,
  ].filter((line): line is string => Boolean(line));
}

function expectedOutput(type: PlannedTask['type']): string {
  if (type === 'analysis') return 'Findings with evidence and uncertainty.';
  if (type === 'implementation') return 'Minimal code changes plus tests.';
  if (type === 'review') return 'Bugs, risks, and required fixes only.';
  return 'Verification commands, results, and residual risk.';
}
