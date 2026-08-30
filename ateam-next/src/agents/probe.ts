import {runProcess} from '../process/runner.js';
import type {AteamEvent} from '../domain/events.js';
import type {AgentAvailability, AgentId} from '../domain/types.js';
import {CodexAdapter} from '../providers/codex/adapter.js';

export async function probeLocalAgents(cwd = process.cwd()): Promise<AteamEvent[]> {
  const at = Date.now();
  const results = await Promise.all([
    probeCodex(cwd, at),
    probeVersionAgent('claude', ['--version'], cwd, at),
    probeVersionAgent('agy', ['--version'], cwd, at),
    probeVersionAgent('grok', ['--version'], cwd, at),
  ]);
  return results;
}

async function probeCodex(cwd: string, at: number): Promise<AteamEvent> {
  const result = await new CodexAdapter('codex', cwd).probe();
  return {
    type: 'AgentAvailabilityChanged',
    agentId: 'codex',
    availability: result.availability,
    version: result.version,
    reason: result.reason,
    at,
  };
}

async function probeVersionAgent(agentId: Exclude<AgentId, 'codex'>, args: string[], cwd: string, at: number): Promise<AteamEvent> {
  try {
    const result = await runProcess({executable: agentId, args, cwd, timeoutMs: 4000});
    const output = result.stdout.trim() || result.stderr.trim();
    return {
      type: 'AgentAvailabilityChanged',
      agentId,
      availability: availabilityFromVersionProbe(result.exitCode ?? -1, output),
      version: extractVersion(output),
      reason: result.exitCode === 0 ? undefined : output || `version probe exited ${result.exitCode}`,
      at,
    };
  } catch (error) {
    return {
      type: 'AgentAvailabilityChanged',
      agentId,
      availability: 'NOT_INSTALLED',
      reason: error instanceof Error ? error.message : String(error),
      at,
    };
  }
}

export function availabilityFromVersionProbe(exitCode: number, output: string): AgentAvailability {
  const lower = output.toLowerCase();
  if (lower.includes('not authenticated') || lower.includes('login required') || lower.includes('auth')) {
    return 'AUTH_ERROR';
  }
  if (exitCode === 0) return 'READY';
  return 'UNKNOWN';
}

function extractVersion(output: string): string | undefined {
  const match = output.match(/([0-9]+(?:\.[0-9]+){1,3})/);
  return match?.[1];
}
