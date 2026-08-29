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

export interface AgentState {
  id: AgentId;
  displayName: string;
  color: 'green' | 'yellow' | 'cyan' | 'magenta';
  availability: AgentAvailability;
  installed: boolean;
  authenticated: boolean | 'UNKNOWN';
  runningTaskCount: number;
  lastError?: string;
}

export interface ConversationEntry {
  id: string;
  speaker: 'You' | 'Ateam' | 'System' | AgentId;
  text: string;
  time: number;
  level: Verbosity;
}

export interface TaskNode {
  id: string;
  objective: string;
  status: TaskStatus;
  assignedAgent?: AgentId;
  priority: number;
}

export interface AppState {
  sessionId: string;
  startedAt: number;
  width: number;
  height: number;
  activeTab: 'Plan' | 'Agents' | 'Tasks' | 'Diff' | 'Context' | 'Logs';
  verbosity: Verbosity;
  permissionMode: PermissionMode;
  agents: Record<AgentId, AgentState>;
  conversation: ConversationEntry[];
  tasks: Record<string, TaskNode>;
  running: boolean;
  quitting: boolean;
  log: string[];
}
