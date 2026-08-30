import type {AgentId, AppState, ConversationEntry, TaskNode} from '../domain/types.js';

export const statusSymbol: Record<string, string> = {
  READY: '*',
  BUSY: '~',
  IDLE: 'o',
  RATE_LIMITED: 'o',
  AUTH_ERROR: '!',
  UNHEALTHY: '!',
  NOT_INSTALLED: 'x',
  NOT_CONFIGURED: 'x',
  SIGNED_OUT: 'x',
  COOLDOWN: 'o',
  DISABLED: 'x',
  UNKNOWN: '?',
};

export function symbolFor(availability: string): string {
  return statusSymbol[availability] ?? 'o';
}

export function formatElapsed(startedAt: number, now = Date.now()): string {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export type PipelinePhase = 'PLAN' | 'IMPLEMENT' | 'VALIDATE' | 'IDLE';

export function derivePhase(state: AppState): string {
  const withPhase = state as AppState & {pipelinePhase?: string};
  if (typeof withPhase.pipelinePhase === 'string' && withPhase.pipelinePhase.length > 0) {
    return withPhase.pipelinePhase;
  }
  if (!state.running) return 'IDLE';
  const runningTasks = Object.values(state.tasks).filter(task => task.status === 'RUNNING');
  if (runningTasks.length === 0) return 'IDLE';
  const signature = (task: TaskNode): string => {
    const withKind = task as TaskNode & {kind?: string};
    return `${withKind.kind ?? ''} ${task.objective}`.toLowerCase();
  };
  if (runningTasks.some(task => /review|verif|valid/.test(signature(task)))) return 'VALIDATE';
  if (runningTasks.some(task => /analy|plan|research/.test(signature(task)))) return 'PLAN';
  return 'IMPLEMENT';
}

export function planSummaryFor(state: AppState): string | undefined {
  const withSummary = state as AppState & {planSummary?: string};
  if (typeof withSummary.planSummary === 'string' && withSummary.planSummary.length > 0) {
    return withSummary.planSummary;
  }
  for (let i = state.conversation.length - 1; i >= 0; i -= 1) {
    const item = state.conversation[i];
    if (item.speaker === 'Ateam') return item.text;
  }
  return undefined;
}

export type ConversationLineKind = 'thinking' | 'tool-call' | 'plain';

export const TOOL_CALL_MARKER = '->';

export function classifyConversationLine(entry: ConversationEntry): ConversationLineKind {
  if (entry.text.startsWith('thinking:')) return 'thinking';
  if (isToolCallText(entry.text)) return 'tool-call';
  return 'plain';
}

export function isToolCallLine(entry: ConversationEntry): boolean {
  return classifyConversationLine(entry) === 'tool-call';
}

export function isDimLine(entry: ConversationEntry): boolean {
  return entry.text.startsWith('thinking:') || entry.text.startsWith('started tool');
}

export function isAgentProseEntry(entry: ConversationEntry): boolean {
  return isAgentSpeaker(entry.speaker) && classifyConversationLine(entry) === 'plain';
}

function isToolCallText(text: string): boolean {
  if (text.startsWith('started tool')) return true;
  return text.startsWith('finished ') && text.includes(': ');
}

function isAgentSpeaker(speaker: ConversationEntry['speaker']): speaker is AgentId {
  return speaker === 'codex' || speaker === 'claude' || speaker === 'agy' || speaker === 'grok';
}

export function speakerColor(speaker: ConversationEntry['speaker'], agents: AppState['agents']): 'green' | 'yellow' | 'cyan' | 'magenta' | 'white' | 'gray' {
  if (speaker === 'System') return 'gray';
  if (speaker in agents) return agents[speaker as AgentId].color;
  return 'white';
}

export function agentTaskSuffix(agent: {runningTaskCount: number}): string {
  return agent.runningTaskCount > 0 ? ` ×${agent.runningTaskCount}` : '';
}

/** Formats a future cooldown timestamp as a short countdown, e.g. "4m 12s left" — or undefined once it's passed. */
export function formatCooldownCountdown(cooldownUntil: number | undefined, now = Date.now()): string | undefined {
  if (cooldownUntil === undefined) return undefined;
  const remainingMs = cooldownUntil - now;
  if (remainingMs <= 0) return undefined;
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s left` : `${seconds}s left`;
}
