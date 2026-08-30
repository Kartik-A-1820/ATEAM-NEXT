import type {AteamEvent} from '../../domain/events.js';

export interface ParseClaudeOptions {
  at?: number;
  taskId?: string;
}

const agentId = 'claude' as const;

export function parseClaudeOutput(raw: string, options: ParseClaudeOptions = {}): AteamEvent[] {
  const at = options.at ?? Date.now();
  const text = raw.trim();
  if (text.length === 0) return [];

  const parsed = parseJson(text);
  if (parsed.ok) {
    return finalize(normalizeValue(parsed.value, {...options, at}), at);
  }

  const events: AteamEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const lineParsed = parseJson(line.trim());
    if (lineParsed.ok) {
      events.push(...normalizeValue(lineParsed.value, {...options, at}));
    } else {
      events.push({type: 'RuntimeError', message: 'Claude emitted malformed JSON output', at});
    }
  }
  return finalize(events, at);
}

export function classifyClaudeFailure(output: string, exitCode: number | null, at = Date.now()): AteamEvent[] {
  const message = output.trim() || `Claude exited ${exitCode ?? 'null'}`;
  const lower = message.toLowerCase();
  if (isAuth(lower)) {
    return [{type: 'AgentAvailabilityChanged', agentId, availability: 'AUTH_ERROR', reason: message, at}];
  }
  if (isRateLimit(lower)) {
    return [{type: 'RateLimited', agentId, at}];
  }
  return [{type: 'RuntimeError', message, at}];
}

function normalizeValue(value: unknown, options: Required<Pick<ParseClaudeOptions, 'at'>> & ParseClaudeOptions): AteamEvent[] {
  if (Array.isArray(value)) {
    return value.flatMap(item => normalizeValue(item, options));
  }
  if (!isRecord(value)) {
    return [{type: 'RuntimeError', message: 'Claude emitted non-object JSON', at: options.at}];
  }

  const type = String(value.type ?? value.event ?? '');
  const error = errorMessage(value);
  if (error || type.includes('error')) {
    const message = error ?? 'Claude error';
    const lower = message.toLowerCase();
    if (isAuth(lower)) return [{type: 'AgentAvailabilityChanged', agentId, availability: 'AUTH_ERROR', reason: message, at: options.at}];
    if (isRateLimit(lower)) return [{type: 'RateLimited', agentId, at: options.at}];
    return [{type: 'RuntimeError', message, at: options.at}];
  }

  if (type.includes('tool') && (type.includes('start') || type.includes('use'))) {
    return [{type: 'ToolStarted', agentId, tool: String(value.name ?? value.tool ?? 'unknown'), at: options.at}];
  }
  if (type.includes('tool') && (type.includes('finish') || type.includes('result'))) {
    return [{type: 'ToolFinished', agentId, tool: String(value.name ?? value.tool ?? 'unknown'), result: String(value.result ?? value.output ?? value.status ?? ''), at: options.at}];
  }

  const thinking = typeof value.thinking === 'string' ? value.thinking : typeof value.summary === 'string' && type.includes('thinking') ? value.summary : undefined;
  const content = textFrom(value);
  const events: AteamEvent[] = [];
  if (thinking) events.push({type: 'ThinkingSummary', agentId, summary: thinking, at: options.at});
  if (content.length > 0) events.push({type: 'AgentStreamDelta', agentId, taskId: options.taskId, delta: content, at: options.at});
  return events;
}

function textFrom(value: Record<string, unknown>): string {
  if (typeof value.result === 'string') return value.result;
  if (typeof value.response === 'string') return value.response;
  if (typeof value.output === 'string') return value.output;
  if (typeof value.text === 'string') return value.text;
  if (typeof value.content === 'string') return value.content;
  if (isRecord(value.message) && typeof value.message.content === 'string') return value.message.content;
  return '';
}

function errorMessage(value: Record<string, unknown>): string | undefined {
  if (typeof value.error === 'string') return value.error;
  if (isRecord(value.error) && typeof value.error.message === 'string') return value.error.message;
  if (typeof value.message === 'string' && String(value.type ?? '').includes('error')) return value.message;
  return undefined;
}

function finalize(events: AteamEvent[], at: number): AteamEvent[] {
  if (events.length === 0) return events;
  if (events.some(event => event.type === 'RuntimeError' || event.type === 'RateLimited')) return events;
  if (events.some(event => event.type === 'AgentAvailabilityChanged' && event.availability === 'AUTH_ERROR')) return events;
  const last = events.at(-1);
  if (last?.type === 'AgentAvailabilityChanged' && last.availability === 'READY') return events;
  return [...events, {type: 'AgentAvailabilityChanged', agentId, availability: 'READY', at}];
}

function parseJson(text: string): {ok: true; value: unknown} | {ok: false} {
  try {
    return {ok: true, value: JSON.parse(text)};
  } catch {
    return {ok: false};
  }
}

function isAuth(lower: string): boolean {
  return lower.includes('not authenticated') || lower.includes('login required') || lower.includes('unauthorized') || lower.includes('auth') || lower.includes('credential');
}

function isRateLimit(lower: string): boolean {
  return lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('quota') || lower.includes('429');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
