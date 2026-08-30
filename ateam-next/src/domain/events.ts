import {z} from 'zod';
import type {AgentAvailability, AgentId, PermissionMode, PipelinePhase, TabName, TaskKind, TaskStatus, Verbosity} from './types.js';

const agentId = z.enum(['codex', 'claude', 'agy', 'grok']);
const availability = z.enum([
  'READY',
  'BUSY',
  'IDLE',
  'NOT_INSTALLED',
  'NOT_CONFIGURED',
  'SIGNED_OUT',
  'AUTH_ERROR',
  'RATE_LIMITED',
  'COOLDOWN',
  'UNHEALTHY',
  'DISABLED',
  'UNKNOWN',
]);
const memoryCategory = z.enum(['FACT', 'HYPOTHESIS', 'DECISION', 'USER_CONSTRAINT', 'AGENT_FINDING', 'TEST_RESULT']);
const verificationState = z.enum(['UNVERIFIED', 'SUPPORTED', 'VERIFIED', 'REJECTED', 'STALE']);

export const eventSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal('SessionStarted'), sessionId: z.string(), at: z.number()}),
  z.object({type: z.literal('TerminalResized'), width: z.number(), height: z.number(), at: z.number()}),
  z.object({type: z.literal('UserMessageReceived'), message: z.string(), at: z.number()}),
  z.object({type: z.literal('UserMessageClassified'), classification: z.string(), at: z.number()}),
  z.object({type: z.literal('AgentAvailabilityChanged'), agentId, availability, reason: z.string().optional(), version: z.string().optional(), at: z.number()}),
  z.object({type: z.literal('AgentStreamDelta'), agentId, taskId: z.string().optional(), delta: z.string(), at: z.number()}),
  z.object({type: z.literal('ThinkingSummary'), agentId, summary: z.string(), at: z.number()}),
  z.object({type: z.literal('ToolStarted'), agentId, tool: z.string(), at: z.number()}),
  z.object({type: z.literal('ToolFinished'), agentId, tool: z.string(), result: z.string(), at: z.number()}),
  z.object({type: z.literal('PermissionRequested'), agentId, capability: z.string(), reason: z.string(), at: z.number()}),
  z.object({type: z.literal('TaskCreated'), taskId: z.string(), objective: z.string(), assignedAgent: agentId.optional(), dependencies: z.array(z.string()).optional(), kind: z.enum(['analysis', 'implementation', 'review', 'verification', 'planning']).optional(), at: z.number()}),
  z.object({type: z.literal('TaskAssigned'), taskId: z.string(), agentId, reason: z.string(), at: z.number()}),
  z.object({type: z.literal('TaskStatusChanged'), taskId: z.string(), status: z.enum(['PENDING', 'READY', 'RUNNING', 'BLOCKED', 'COMPLETED', 'FAILED', 'CANCELLED', 'INVALIDATED']), at: z.number()}),
  z.object({type: z.literal('PlanUpdated'), summary: z.string(), at: z.number()}),
  z.object({type: z.literal('ContextUpdated'), summary: z.string(), at: z.number()}),
  z.object({
    type: z.literal('MemoryUpdated'),
    memoryId: z.string(),
    category: memoryCategory,
    content: z.string(),
    verification: verificationState,
    sourceAgent: agentId.optional(),
    sourceTask: z.string().optional(),
    evidence: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1).optional(),
    at: z.number(),
  }),
  z.object({type: z.literal('RateLimited'), agentId, resetHint: z.string().optional(), at: z.number()}),
  z.object({type: z.literal('TaskReassigned'), taskId: z.string(), fromAgent: agentId.optional(), toAgent: agentId, reason: z.string(), attempt: z.number(), at: z.number()}),
  z.object({type: z.literal('AgentCooldownChanged'), agentId, cooldownUntil: z.number().optional(), reason: z.string(), at: z.number()}),
  z.object({type: z.literal('KnowledgeGraphIndexed'), fileCount: z.number(), symbolCount: z.number(), durationMs: z.number(), at: z.number()}),
  z.object({type: z.literal('RuntimeError'), message: z.string(), at: z.number()}),
  z.object({type: z.literal('VerbosityChanged'), verbosity: z.enum(['QUIET', 'NORMAL', 'VERBOSE', 'TRACE']), at: z.number()}),
  z.object({type: z.literal('PermissionModeChanged'), mode: z.enum(['SAFE', 'STANDARD', 'FULL']), at: z.number()}),
  z.object({type: z.literal('StopRequested'), scope: z.string(), at: z.number()}),
  z.object({type: z.literal('ViewChanged'), tab: z.enum(['Plan', 'Agents', 'Tasks', 'Diff', 'Context', 'Logs']), at: z.number()}),
  z.object({type: z.literal('TaskInvalidated'), taskId: z.string(), reason: z.string(), at: z.number()}),
  z.object({type: z.literal('PipelinePhaseChanged'), phase: z.enum(['PLAN', 'DISTRIBUTE', 'IMPLEMENT', 'VALIDATE', 'IDLE']), at: z.number()}),
  z.object({type: z.literal('ConversationCleared'), at: z.number()}),
  z.object({type: z.literal('AteamReplied'), text: z.string(), at: z.number()}),
]);

export type AteamEvent = z.infer<typeof eventSchema>;

export interface ProviderAdapter {
  id: AgentId;
  probe(): Promise<{availability: AgentAvailability; version?: string; reason?: string}>;
  startSession(send: (event: AteamEvent) => void, signal: AbortSignal): Promise<void>;
  send(message: string): Promise<void>;
  cancel(scope?: string): Promise<void>;
  shutdown(): Promise<void>;
}

export interface ExecutableProviderAdapter extends ProviderAdapter {
  runOnce(message: string): Promise<AteamEvent[]>;
  /**
   * Same contract as runOnce, but emits each parsed event via onEvent as soon
   * as its line of provider output arrives, instead of buffering the whole
   * run and returning an array at the end. Used for interactive real-mode
   * task execution so the TUI shows live progress; runOnce stays for callers
   * (headless mode, tests) that are fine with a buffered result. signal
   * allows the caller to abort the underlying process mid-run.
   */
  runStreaming(message: string, onEvent: (event: AteamEvent) => void, signal: AbortSignal): Promise<void>;
}

export type RuntimeCommand =
  | {kind: 'submitUserMessage'; message: string}
  | {kind: 'slashCommand'; name: string; args: string[]}
  | {kind: 'setVerbosity'; verbosity: Verbosity}
  | {kind: 'setPermissionMode'; mode: PermissionMode}
  | {kind: 'stop'; scope: string}
  | {kind: 'quit'};

export type StopScope =
  | {kind: 'all'}
  | {kind: 'current'}
  | {kind: 'task'; taskId: string}
  | {kind: 'agent'; agentId: AgentId};

export function parseStopScope(raw = 'current'): StopScope {
  const value = raw.trim().toLowerCase();
  if (value === 'all') return {kind: 'all'};
  if (value === 'current' || value.length === 0) return {kind: 'current'};
  if (value.startsWith('task:')) return {kind: 'task', taskId: value.slice('task:'.length).toUpperCase()};
  if (value.startsWith('agent:')) {
    const agentId = value.slice('agent:'.length);
    if (agentId === 'codex' || agentId === 'claude' || agentId === 'agy' || agentId === 'grok') {
      return {kind: 'agent', agentId};
    }
  }
  return {kind: 'current'};
}

export function tabForCommand(name: string): TabName | undefined {
  const normalized = name.toLowerCase();
  if (normalized === 'plan') return 'Plan';
  if (normalized === 'agents') return 'Agents';
  if (normalized === 'tasks') return 'Tasks';
  if (normalized === 'diff') return 'Diff';
  if (normalized === 'context' || normalized === 'memory') return 'Context';
  if (normalized === 'logs' || normalized === 'status' || normalized === 'usage' || normalized === 'doctor') return 'Logs';
  return undefined;
}

export type {AgentAvailability, AgentId, PermissionMode, PipelinePhase, TaskKind, TaskStatus, Verbosity};
