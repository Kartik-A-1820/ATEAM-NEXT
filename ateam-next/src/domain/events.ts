import {z} from 'zod';
import type {AgentAvailability, AgentId, PermissionMode, TaskStatus, Verbosity} from './types.js';

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

export const eventSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal('SessionStarted'), sessionId: z.string(), at: z.number()}),
  z.object({type: z.literal('TerminalResized'), width: z.number(), height: z.number(), at: z.number()}),
  z.object({type: z.literal('UserMessageReceived'), message: z.string(), at: z.number()}),
  z.object({type: z.literal('UserMessageClassified'), classification: z.string(), at: z.number()}),
  z.object({type: z.literal('AgentAvailabilityChanged'), agentId, availability, reason: z.string().optional(), at: z.number()}),
  z.object({type: z.literal('AgentStreamDelta'), agentId, taskId: z.string().optional(), delta: z.string(), at: z.number()}),
  z.object({type: z.literal('ThinkingSummary'), agentId, summary: z.string(), at: z.number()}),
  z.object({type: z.literal('ToolStarted'), agentId, tool: z.string(), at: z.number()}),
  z.object({type: z.literal('ToolFinished'), agentId, tool: z.string(), result: z.string(), at: z.number()}),
  z.object({type: z.literal('PermissionRequested'), agentId, capability: z.string(), reason: z.string(), at: z.number()}),
  z.object({type: z.literal('TaskCreated'), taskId: z.string(), objective: z.string(), assignedAgent: agentId.optional(), at: z.number()}),
  z.object({type: z.literal('TaskStatusChanged'), taskId: z.string(), status: z.enum(['PENDING', 'READY', 'RUNNING', 'BLOCKED', 'COMPLETED', 'FAILED', 'CANCELLED', 'INVALIDATED']), at: z.number()}),
  z.object({type: z.literal('PlanUpdated'), summary: z.string(), at: z.number()}),
  z.object({type: z.literal('ContextUpdated'), summary: z.string(), at: z.number()}),
  z.object({type: z.literal('RateLimited'), agentId, resetHint: z.string().optional(), at: z.number()}),
  z.object({type: z.literal('RuntimeError'), message: z.string(), at: z.number()}),
  z.object({type: z.literal('VerbosityChanged'), verbosity: z.enum(['QUIET', 'NORMAL', 'VERBOSE', 'TRACE']), at: z.number()}),
  z.object({type: z.literal('PermissionModeChanged'), mode: z.enum(['SAFE', 'STANDARD', 'FULL']), at: z.number()}),
  z.object({type: z.literal('StopRequested'), scope: z.string(), at: z.number()}),
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

export type RuntimeCommand =
  | {kind: 'submitUserMessage'; message: string}
  | {kind: 'slashCommand'; name: string; args: string[]}
  | {kind: 'setVerbosity'; verbosity: Verbosity}
  | {kind: 'setPermissionMode'; mode: PermissionMode}
  | {kind: 'stop'; scope: string}
  | {kind: 'quit'};

export type {AgentAvailability, AgentId, PermissionMode, TaskStatus, Verbosity};
