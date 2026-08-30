export type AgentId = 'codex' | 'claude' | 'agy' | 'grok';

export type AgentAvailability =
  | 'READY'
  | 'BUSY'
  | 'IDLE'
  | 'NOT_INSTALLED'
  | 'NOT_CONFIGURED'
  | 'SIGNED_OUT'
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'COOLDOWN'
  | 'UNHEALTHY'
  | 'DISABLED'
  | 'UNKNOWN';

export type Verbosity = 'QUIET' | 'NORMAL' | 'VERBOSE' | 'TRACE';
export type PermissionMode = 'SAFE' | 'STANDARD' | 'FULL';
export type TaskStatus = 'PENDING' | 'READY' | 'RUNNING' | 'BLOCKED' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'INVALIDATED';
export type TabName = 'Plan' | 'Agents' | 'Tasks' | 'Diff' | 'Context' | 'Logs';
export type PipelinePhase = 'PLAN' | 'DISTRIBUTE' | 'IMPLEMENT' | 'VALIDATE' | 'IDLE';
export type TaskKind = 'analysis' | 'implementation' | 'review' | 'verification' | 'planning';

export interface AgentState {
  id: AgentId;
  displayName: string;
  color: 'green' | 'yellow' | 'cyan' | 'magenta';
  availability: AgentAvailability;
  installed: boolean;
  authenticated: boolean | 'UNKNOWN';
  version?: string;
  runningTaskCount: number;
  lastError?: string;
  currentTaskId?: string;
  currentTaskObjective?: string;
  cooldownUntil?: number;
  cooldownReason?: string;
}

export interface TaskAttempt {
  agentId: AgentId;
  reason: string;
  at: number;
}

export interface ConversationEntry {
  id: string;
  speaker: 'You' | 'Ateam' | 'System' | AgentId;
  text: string;
  time: number;
  level: Verbosity;
  taskId?: string;
}

export interface TaskNode {
  id: string;
  objective: string;
  status: TaskStatus;
  assignedAgent?: AgentId;
  dependencies: string[];
  priority: number;
  kind?: TaskKind;
  attempts?: TaskAttempt[];
}

export interface AppState {
  sessionId: string;
  startedAt: number;
  width: number;
  height: number;
  activeTab: TabName;
  verbosity: Verbosity;
  permissionMode: PermissionMode;
  pipelinePhase: PipelinePhase;
  planSummary?: string;
  agents: Record<AgentId, AgentState>;
  conversation: ConversationEntry[];
  tasks: Record<string, TaskNode>;
  running: boolean;
  quitting: boolean;
  log: string[];
  openStreams?: Record<string, string>;
}
