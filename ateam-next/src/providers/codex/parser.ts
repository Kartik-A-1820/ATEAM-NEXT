import type {AteamEvent} from '../../domain/events.js';

export interface ParseCodexOptions {
  at?: number;
  taskId?: string;
}

export function parseCodexJsonl(jsonl: string, options: ParseCodexOptions = {}): AteamEvent[] {
  const events: AteamEvent[] = [];
  const at = options.at ?? Date.now();

  for (const line of jsonl.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      events.push({type: 'RuntimeError', message: 'Codex emitted malformed JSONL event', at});
      continue;
    }
    const event = normalizeCodexEvent(parsed, {...options, at});
    if (event) events.push(event);
  }

  return events;
}

function normalizeCodexEvent(raw: unknown, options: Required<Pick<ParseCodexOptions, 'at'>> & ParseCodexOptions): AteamEvent | undefined {
  if (!isRecord(raw)) return {type: 'RuntimeError', message: 'Codex emitted non-object JSON event', at: options.at};
  const type = String(raw.type ?? raw.event ?? '');
  if (type.includes('delta')) {
    const delta = String(raw.delta ?? raw.text ?? raw.content ?? '');
    return {type: 'AgentStreamDelta', agentId: 'codex', taskId: options.taskId, delta, at: options.at};
  }
  if (type.includes('tool') && type.includes('started')) {
    return {type: 'ToolStarted', agentId: 'codex', tool: String(raw.name ?? raw.tool ?? 'unknown'), at: options.at};
  }
  if (type.includes('tool') && type.includes('finished')) {
    return {type: 'ToolFinished', agentId: 'codex', tool: String(raw.name ?? raw.tool ?? 'unknown'), result: String(raw.result ?? raw.status ?? ''), at: options.at};
  }
  if (type.includes('error')) {
    const message = String(raw.message ?? raw.error ?? 'Codex error');
    const lower = message.toLowerCase();
    if (lower.includes('rate limit') || lower.includes('quota')) {
      return {type: 'RateLimited', agentId: 'codex', at: options.at};
    }
    if (lower.includes('auth') || lower.includes('login') || lower.includes('signed')) {
      return {type: 'AgentAvailabilityChanged', agentId: 'codex', availability: 'AUTH_ERROR', reason: message, at: options.at};
    }
    return {type: 'RuntimeError', message, at: options.at};
  }
  if (type.includes('session') && type.includes('started')) {
    return {type: 'AgentAvailabilityChanged', agentId: 'codex', availability: 'BUSY', at: options.at};
  }
  if (type.includes('completed')) {
    return {type: 'AgentAvailabilityChanged', agentId: 'codex', availability: 'READY', at: options.at};
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
