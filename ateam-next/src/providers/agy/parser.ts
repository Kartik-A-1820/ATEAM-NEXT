import type {AteamEvent} from '../../domain/events.js';

export interface ParseAgyOptions {
  at?: number;
  taskId?: string;
}

/**
 * Parse a single JSON object (or a line of JSONL) from AGY's
 * `--output-format json` output and emit the corresponding AteamEvents.
 *
 * AGY emits either a single JSON object (full completion) or multiple JSONL
 * objects during streaming.  Both formats are handled here by treating the
 * input as a series of newline-delimited JSON lines.
 */
export function parseAgyOutput(raw: string, options: ParseAgyOptions = {}): AteamEvent[] {
  const events: AteamEvent[] = [];
  const at = options.at ?? Date.now();

  // Attempt to parse the entire output as a single JSON object first
  // (the non-streaming --output-format json path).
  const stripped = raw.trim();
  if (stripped.startsWith('{') || stripped.startsWith('[')) {
    let single: unknown;
    try {
      single = JSON.parse(stripped);
    } catch {
      single = undefined;
    }
    if (single !== undefined) {
      const normalized = normalizeAgyObject(single, {...options, at});
      events.push(...normalized);
      // Append a terminal READY unless the output already closed with one.
      const lastEvent = events.at(-1);
      if (!lastEvent || lastEvent.type !== 'AgentAvailabilityChanged' || (lastEvent as {availability?: string}).availability !== 'READY') {
        events.push({type: 'AgentAvailabilityChanged', agentId: 'agy', availability: 'READY', at});
      }
      return events;
    }
  }

  // Fall through to JSONL line-by-line parsing.
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      events.push({type: 'RuntimeError', message: 'AGY emitted malformed JSON output', at});
      continue;
    }
    const lineEvents = normalizeAgyObject(parsed, {...options, at});
    events.push(...lineEvents);
  }

  // Append READY sentinel if there were any content events but no terminal READY.
  const hasContent = events.some(e => e.type === 'AgentStreamDelta' || e.type === 'ToolStarted' || e.type === 'ToolFinished');
  const alreadyReady = events.some(e => e.type === 'AgentAvailabilityChanged' && (e as {availability?: string}).availability === 'READY');
  if (hasContent && !alreadyReady) {
    events.push({type: 'AgentAvailabilityChanged', agentId: 'agy', availability: 'READY', at});
  }

  return events;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type ResolvedOptions = Required<Pick<ParseAgyOptions, 'at'>> & ParseAgyOptions;

function normalizeAgyObject(raw: unknown, options: ResolvedOptions): AteamEvent[] {
  // Array of objects – iterate each element.
  if (Array.isArray(raw)) {
    return raw.flatMap(item => normalizeAgyObject(item, options));
  }

  if (!isRecord(raw)) {
    return [{type: 'RuntimeError', message: 'AGY emitted non-object JSON', at: options.at}];
  }

  // AGY completion response: { output, model, usage, ... }
  // The primary signal here is the presence of "output" as a string.
  if (typeof raw.output === 'string') {
    return normalizeCompletionObject(raw, options);
  }

  // Streaming delta events: { type: "content_block_delta"|"output_text", delta|text, ... }
  const type = String(raw.type ?? raw.event ?? '');

  if (isDeltaEvent(type, raw)) {
    const delta = extractDeltaText(raw);
    return [{type: 'AgentStreamDelta', agentId: 'agy', taskId: options.taskId, delta, at: options.at}];
  }

  if (isToolStart(type)) {
    const tool = String(raw.name ?? raw.tool ?? raw.function_name ?? 'unknown');
    return [{type: 'ToolStarted', agentId: 'agy', tool, at: options.at}];
  }

  if (isToolEnd(type)) {
    const tool = String(raw.name ?? raw.tool ?? raw.function_name ?? 'unknown');
    const result = String(raw.result ?? raw.output ?? raw.status ?? '');
    return [{type: 'ToolFinished', agentId: 'agy', tool, result, at: options.at}];
  }

  if (isErrorEvent(type)) {
    return [normalizeErrorObject(raw, options)];
  }

  if (type.includes('completed') || type.includes('done') || type.includes('finish')) {
    return [{type: 'AgentAvailabilityChanged', agentId: 'agy', availability: 'READY', at: options.at}];
  }

  if (type.includes('start') && !type.includes('tool')) {
    return [{type: 'AgentAvailabilityChanged', agentId: 'agy', availability: 'BUSY', at: options.at}];
  }

  // Unknown future fields: tolerate and skip.
  return [];
}

/**
 * Normalize a single-shot completion object:
 * { output: "...", model: "...", usage: {...}, ... }
 */
function normalizeCompletionObject(raw: Record<string, unknown>, options: ResolvedOptions): AteamEvent[] {
  const output = String(raw.output);
  const lower = output.toLowerCase();

  // Auth error surfaced through the output field (edge case).
  if (isAuthErrorString(lower)) {
    return [{type: 'AgentAvailabilityChanged', agentId: 'agy', availability: 'AUTH_ERROR', reason: output, at: options.at}];
  }
  if (isRateLimitString(lower)) {
    return [{type: 'RateLimited', agentId: 'agy', at: options.at}];
  }

  const events: AteamEvent[] = [];
  if (output.length > 0) {
    events.push({type: 'AgentStreamDelta', agentId: 'agy', taskId: options.taskId, delta: output, at: options.at});
  }
  events.push({type: 'AgentAvailabilityChanged', agentId: 'agy', availability: 'READY', at: options.at});
  return events;
}

function normalizeErrorObject(raw: Record<string, unknown>, options: ResolvedOptions): AteamEvent {
  const message = String(raw.message ?? raw.error ?? raw.detail ?? 'AGY error');
  const lower = message.toLowerCase();

  if (isAuthErrorString(lower)) {
    return {type: 'AgentAvailabilityChanged', agentId: 'agy', availability: 'AUTH_ERROR', reason: message, at: options.at};
  }
  if (isRateLimitString(lower)) {
    return {type: 'RateLimited', agentId: 'agy', at: options.at};
  }
  return {type: 'RuntimeError', message, at: options.at};
}

// ---------------------------------------------------------------------------
// Event classification predicates
// ---------------------------------------------------------------------------

function isDeltaEvent(type: string, raw: Record<string, unknown>): boolean {
  return (
    type.includes('delta') ||
    type === 'output_text' ||
    type.includes('content_block') ||
    (type === '' && (typeof raw.delta === 'string' || typeof raw.text === 'string'))
  );
}

function isToolStart(type: string): boolean {
  if (!type.includes('tool') && !type.includes('function_call')) return false;
  // Use endsWith to avoid "tool_use_end" being mis-classified as a start event.
  return type.endsWith('_start') || type.endsWith('_begin') || (type.endsWith('_use') && !type.includes('_end'));
}

function isToolEnd(type: string): boolean {
  if (!type.includes('tool') && !type.includes('function_call')) return false;
  return type.endsWith('_end') || type.endsWith('_finish') || type.endsWith('_result') || type.includes('finished');
}

function isErrorEvent(type: string): boolean {
  return type.includes('error') || type === 'exception';
}

function extractDeltaText(raw: Record<string, unknown>): string {
  // Handle nested delta objects: { delta: { type: "text_delta", text: "..." } }
  if (raw.delta && isRecord(raw.delta) && typeof raw.delta.text === 'string') {
    return raw.delta.text;
  }
  return String(raw.delta ?? raw.text ?? raw.content ?? raw.output ?? '');
}

function isAuthErrorString(lower: string): boolean {
  return (
    lower.includes('auth') ||
    lower.includes('login') ||
    lower.includes('sign') ||
    lower.includes('credential') ||
    lower.includes('unauthorized') ||
    lower.includes('not authenticated') ||
    lower.includes('403')
  );
}

function isRateLimitString(lower: string): boolean {
  return lower.includes('rate limit') || lower.includes('quota') || lower.includes('too many request') || lower.includes('429');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
