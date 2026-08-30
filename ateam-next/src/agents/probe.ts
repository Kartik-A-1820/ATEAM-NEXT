import type {AteamEvent} from '../domain/events.js';
import type {AgentAvailability, AgentId} from '../domain/types.js';
import {CodexAdapter} from '../providers/codex/adapter.js';
import {ClaudeAdapter} from '../providers/claude/adapter.js';
import {AgyAdapter} from '../providers/agy/adapter.js';
import {GrokAdapter} from '../providers/grok/adapter.js';

export async function probeLocalAgents(cwd = process.cwd()): Promise<AteamEvent[]> {
  const at = Date.now();
  const results = await Promise.all([
    probeAdapter(new CodexAdapter('codex', cwd), at),
    probeAdapter(new ClaudeAdapter('claude', cwd), at),
    probeAdapter(new AgyAdapter('agy', cwd), at),
    probeAdapter(new GrokAdapter('grok', cwd), at),
  ]);
  return results;
}

async function probeAdapter(adapter: {id: AgentId; probe(): Promise<{availability: AgentAvailability; version?: string; reason?: string}>}, at: number): Promise<AteamEvent> {
  const result = await adapter.probe();
  return {
    type: 'AgentAvailabilityChanged',
    agentId: adapter.id,
    availability: result.availability,
    version: result.version,
    reason: result.reason,
    at,
  };
}

export function availabilityFromVersionProbe(exitCode: number, output: string): AgentAvailability {
  const lower = output.toLowerCase();
  if (lower.includes('not authenticated') || lower.includes('login required') || lower.includes('auth')) {
    return 'AUTH_ERROR';
  }
  if (exitCode === 0) return 'READY';
  return 'UNKNOWN';
}
