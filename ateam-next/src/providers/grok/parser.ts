import type {AteamEvent} from '../../domain/events.js';

export interface ParseGrokOptions {
  at?: number;
  taskId?: string;
}

const AGENT_ID = 'grok' as const;

export function parseGrokOutput(raw: string, options: ParseGrokOptions = {}): AteamEvent[] {
  const at = options.at ?? Date.now();
  const stripped = raw.trim();
  if (stripped.length === 0) {
    return [{type: 'RuntimeError', message: 'Grok emitted empty JSON output', at}];
  }

  const parsed = tryParseJsonPayload(stripped);
  if (parsed.ok) {
    return finalizeGrokEvents(normalizeGrokValue(parsed.value, {...options, at}), at);
  }

  const events: AteamEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    try {
      events.push(...normalizeGrokValue(JSON.parse(line), {...options, at}));
    } catch {
      events.push({type: 'RuntimeError', message: 'Grok emitted malformed JSON', at});
    }
  }

  if (events.length === 0) {
    return [{type: 'RuntimeError', message: 'Grok emitted malformed JSON', at}];
  }
  return finalizeGrokEvents(events, at);
}

export function classifyGrokPlainFailure(output: string, exitCode: number, at = Date.now()): AteamEvent[] {
  const message = output.trim() || `Grok exited ${exitCode}`;
  if (looksLikeAuthFailure(message)) {
    return [{type: 'AgentAvailabilityChanged', agentId: AGENT_ID, availability: 'AUTH_ERROR', reason: message, at}];
  }
  if (looksLikeRateLimit(message)) {
    const resetHint = extractResetHint(message);
    return [{type: 'RateLimited', agentId: AGENT_ID, resetHint, at}];
  }
  return [{type: 'RuntimeError', message, at}];
}

export function looksLikeAuthFailure(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('not authenticated')
    || lower.includes('unauthenticated')
    || lower.includes('authentication failed')
    || lower.includes('auth failed')
    || lower.includes('login required')
    || lower.includes('please login')
    || lower.includes('please log in')
    || lower.includes('signed out')
    || lower.includes('unauthorized')
    || lower.includes('invalid api key')
    || lower.includes('missing api key')
    || lower.includes('api key is missing')
    || /\b401\b/.test(lower)
  );
}

export function looksLikeRateLimit(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('rate limit')
    || lower.includes('rate-limit')
    || lower.includes('ratelimit')
    || lower.includes('too many requests')
    || lower.includes('quota exceeded')
    || lower.includes('resource exhausted')
    || /\b429\b/.test(lower)
  );
}

function normalizeGrokValue(raw: unknown, options: Required<Pick<ParseGrokOptions, 'at'>> & ParseGrokOptions): AteamEvent[] {
  if (Array.isArray(raw)) {
    return raw.flatMap(item => normalizeGrokValue(item, options));
  }
  if (!isRecord(raw)) {
    return [{type: 'RuntimeError', message: 'Grok emitted non-object JSON', at: options.at}];
  }

  const errorEvent = errorEventFromRecord(raw, options);
  if (errorEvent) return [errorEvent];

  const type = String(raw.type ?? raw.event ?? '');
  if (type.includes('delta') || type.includes('message_chunk') || type === 'assistant') {
    const delta = extractCompletionText(raw);
    return delta.length > 0
      ? [{type: 'AgentStreamDelta', agentId: AGENT_ID, taskId: options.taskId, delta, at: options.at}]
      : [];
  }
  if (type.includes('tool') && (type.includes('start') || type.includes('begin'))) {
    return [{type: 'ToolStarted', agentId: AGENT_ID, tool: String(raw.name ?? raw.tool ?? 'unknown'), at: options.at}];
  }
  if (type.includes('tool') && (type.includes('finish') || type.includes('end') || type.includes('result'))) {
    return [{type: 'ToolFinished', agentId: AGENT_ID, tool: String(raw.name ?? raw.tool ?? 'unknown'), result: String(raw.result ?? raw.status ?? ''), at: options.at}];
  }
  if (type.includes('session') && type.includes('start')) {
    return [{type: 'AgentAvailabilityChanged', agentId: AGENT_ID, availability: 'BUSY', at: options.at}];
  }
  if (type.includes('completed') || type.includes('done') || type.includes('finish')) {
    return [{type: 'AgentAvailabilityChanged', agentId: AGENT_ID, availability: 'READY', at: options.at}];
  }

  const events: AteamEvent[] = [];
  if (typeof raw.thought === 'string' && raw.thought.length > 0) {
    events.push({type: 'ThinkingSummary', agentId: AGENT_ID, summary: raw.thought, at: options.at});
  }
  const text = extractCompletionText(raw);
  if (text.length > 0) {
    events.push({type: 'AgentStreamDelta', agentId: AGENT_ID, taskId: options.taskId, delta: text, at: options.at});
  }
  return events;
}

function errorEventFromRecord(raw: Record<string, unknown>, options: Required<Pick<ParseGrokOptions, 'at'>> & ParseGrokOptions): AteamEvent | undefined {
  const type = String(raw.type ?? raw.event ?? raw.code ?? '');
  const message = errorMessageFromRecord(raw);
  const typedError = type.includes('error') || type.includes('exception') || type.includes('unauthenticated') || type.includes('rate_limit');
  if (!message) {
    return typedError ? classifyErrorMessage('Grok error', options) : undefined;
  }
  if (typedError || looksLikeAuthFailure(message) || looksLikeRateLimit(message) || raw.error !== undefined) {
    return classifyErrorMessage(message, options);
  }
  return undefined;
}

function errorMessageFromRecord(raw: Record<string, unknown>): string | undefined {
  if (typeof raw.error === 'string' && raw.error.length > 0) return raw.error;
  if (isRecord(raw.error)) {
    if (typeof raw.error.message === 'string' && raw.error.message.length > 0) return raw.error.message;
    if (typeof raw.error.type === 'string' && raw.error.type.length > 0) return raw.error.type;
  }
  if (typeof raw.message === 'string' && raw.message.length > 0 && isErrorishRecord(raw)) {
    return raw.message;
  }
  return undefined;
}

function isErrorishRecord(raw: Record<string, unknown>): boolean {
  const type = String(raw.type ?? raw.event ?? raw.code ?? '');
  return raw.error !== undefined || type.includes('error') || type.includes('exception') || type.includes('unauthenticated') || type.includes('rate_limit');
}

function classifyErrorMessage(message: string, options: Required<Pick<ParseGrokOptions, 'at'>>): AteamEvent {
  if (looksLikeAuthFailure(message)) {
    return {type: 'AgentAvailabilityChanged', agentId: AGENT_ID, availability: 'AUTH_ERROR', reason: message, at: options.at};
  }
  if (looksLikeRateLimit(message)) {
    return {type: 'RateLimited', agentId: AGENT_ID, resetHint: extractResetHint(message), at: options.at};
  }
  return {type: 'RuntimeError', message, at: options.at};
}

function extractCompletionText(raw: Record<string, unknown>): string {
  if (typeof raw.text === 'string') return raw.text;
  if (typeof raw.output === 'string') return raw.output;
  if (typeof raw.delta === 'string') return raw.delta;
  if (typeof raw.content === 'string') return raw.content;
  if (isRecord(raw.delta) && typeof raw.delta.text === 'string') return raw.delta.text;
  if (isRecord(raw.content) && typeof raw.content.text === 'string') return raw.content.text;
  if (isRecord(raw.message) && typeof raw.message.content === 'string') return raw.message.content;
  if (isRecord(raw.update) && isRecord(raw.update.content) && typeof raw.update.content.text === 'string') {
    return raw.update.content.text;
  }
  return '';
}

function finalizeGrokEvents(events: AteamEvent[], at: number): AteamEvent[] {
  if (events.some(isBlockingEvent)) return events;
  const last = events.at(-1);
  if (last?.type === 'AgentAvailabilityChanged' && last.availability === 'READY') return events;
  events.push({type: 'AgentAvailabilityChanged', agentId: AGENT_ID, availability: 'READY', at});
  return events;
}

function isBlockingEvent(event: AteamEvent): boolean {
  if (event.type === 'RuntimeError' || event.type === 'RateLimited') return true;
  return event.type === 'AgentAvailabilityChanged' && event.availability === 'AUTH_ERROR';
}

function tryParseJsonPayload(raw: string): {ok: true; value: unknown} | {ok: false} {
  try {
    return {ok: true, value: JSON.parse(raw)};
  } catch {
    // JSONL and other multi-value stdout must not be spliced from first brace to last.
    // Only peel a non-JSON prefix such as a banner before a single object/array.
    if (raw.startsWith('{') || raw.startsWith('[')) return {ok: false};
    const start = raw.search(/[{[]/);
    if (start <= 0) return {ok: false};
    try {
      return {ok: true, value: JSON.parse(raw.slice(start))};
    } catch {
      return {ok: false};
    }
  }
}

function extractResetHint(message: string): string | undefined {
  const match = message.match(/retry[- ]after[:\s]+([^\s,;]+)/i) ?? message.match(/reset(?:s|ting)?[:\s]+([^\s,;]+)/i);
  return match?.[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
