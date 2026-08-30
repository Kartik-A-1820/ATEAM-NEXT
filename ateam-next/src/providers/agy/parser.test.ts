import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {parseAgyOutput} from './parser.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

// ---------------------------------------------------------------------------
// Parser — fixture-driven tests
// ---------------------------------------------------------------------------

describe('parseAgyOutput — completion.json (single-shot JSON)', () => {
  it('emits an AgentStreamDelta containing the full output text', () => {
    const events = parseAgyOutput(readFileSync(join(fixtures, 'completion.json'), 'utf8'), {at: 1, taskId: 'T1'});
    expect(events).toContainEqual({
      type: 'AgentStreamDelta',
      agentId: 'agy',
      taskId: 'T1',
      delta: 'Hello, world! How can I help you today?',
      at: 1,
    });
  });

  it('appends a terminal READY event', () => {
    const events = parseAgyOutput(readFileSync(join(fixtures, 'completion.json'), 'utf8'), {at: 1});
    expect(events.at(-1)).toMatchObject({type: 'AgentAvailabilityChanged', agentId: 'agy', availability: 'READY'});
  });
});

describe('parseAgyOutput — streaming.jsonl (JSONL streaming)', () => {
  it('emits AgentStreamDelta for each text delta', () => {
    const events = parseAgyOutput(readFileSync(join(fixtures, 'streaming.jsonl'), 'utf8'), {at: 2, taskId: 'T2'});
    const deltas = events.filter(e => e.type === 'AgentStreamDelta');
    expect(deltas.length).toBeGreaterThanOrEqual(2);
    expect(deltas[0]).toMatchObject({type: 'AgentStreamDelta', agentId: 'agy', taskId: 'T2', delta: 'Hello '});
    expect(deltas[1]).toMatchObject({type: 'AgentStreamDelta', agentId: 'agy', taskId: 'T2', delta: 'world'});
  });

  it('emits ToolStarted and ToolFinished for shell invocations', () => {
    const events = parseAgyOutput(readFileSync(join(fixtures, 'streaming.jsonl'), 'utf8'), {at: 2});
    expect(events.some(e => e.type === 'ToolStarted')).toBe(true);
    expect(events.some(e => e.type === 'ToolFinished')).toBe(true);
    const started = events.find(e => e.type === 'ToolStarted') as {tool: string} | undefined;
    expect(started?.tool).toBe('shell');
  });

  it('ends with a READY availability event', () => {
    const events = parseAgyOutput(readFileSync(join(fixtures, 'streaming.jsonl'), 'utf8'), {at: 2});
    expect(events.at(-1)).toMatchObject({type: 'AgentAvailabilityChanged', agentId: 'agy', availability: 'READY'});
  });
});

describe('parseAgyOutput — auth_failure.jsonl', () => {
  it('normalizes auth error to AUTH_ERROR AgentAvailabilityChanged', () => {
    const events = parseAgyOutput(readFileSync(join(fixtures, 'auth_failure.jsonl'), 'utf8'), {at: 3});
    expect(events[0]).toMatchObject({
      type: 'AgentAvailabilityChanged',
      agentId: 'agy',
      availability: 'AUTH_ERROR',
    });
  });
});

describe('parseAgyOutput — rate_limit.jsonl', () => {
  it('normalizes rate-limit error to RateLimited event', () => {
    const events = parseAgyOutput(readFileSync(join(fixtures, 'rate_limit.jsonl'), 'utf8'), {at: 4});
    expect(events[0]).toMatchObject({type: 'RateLimited', agentId: 'agy'});
  });
});

describe('parseAgyOutput — malformed.jsonl', () => {
  it('emits RuntimeError for the malformed JSON line', () => {
    const events = parseAgyOutput(readFileSync(join(fixtures, 'malformed.jsonl'), 'utf8'), {at: 5});
    expect(events.some(e => e.type === 'RuntimeError')).toBe(true);
  });

  it('still emits AgentStreamDelta for the valid delta lines', () => {
    const events = parseAgyOutput(readFileSync(join(fixtures, 'malformed.jsonl'), 'utf8'), {at: 5});
    const deltas = events.filter(e => e.type === 'AgentStreamDelta');
    expect(deltas.length).toBeGreaterThanOrEqual(2);
  });

  it('silently skips unknown future event types', () => {
    const events = parseAgyOutput(readFileSync(join(fixtures, 'malformed.jsonl'), 'utf8'), {at: 5});
    const unknownErrors = events.filter(
      e => e.type === 'RuntimeError' && (e as {message?: string}).message?.includes('unknown'),
    );
    expect(unknownErrors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Parser — synthetic / inline tests
// ---------------------------------------------------------------------------

describe('parseAgyOutput — synthetic inline cases', () => {
  it('handles nested delta objects { delta: { text: "..." } }', () => {
    const line = JSON.stringify({type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: 'nested'}});
    const events = parseAgyOutput(line, {at: 10});
    expect(events).toContainEqual(expect.objectContaining({type: 'AgentStreamDelta', delta: 'nested'}));
  });

  it('treats output field auth text as AUTH_ERROR', () => {
    const single = JSON.stringify({output: 'Not authenticated. Please sign in.', model: 'agy-2'});
    const events = parseAgyOutput(single, {at: 10});
    expect(events[0]).toMatchObject({type: 'AgentAvailabilityChanged', availability: 'AUTH_ERROR'});
  });

  it('treats output field rate-limit text as RateLimited', () => {
    const single = JSON.stringify({output: 'rate limit exceeded', model: 'agy-2'});
    const events = parseAgyOutput(single, {at: 10});
    expect(events[0]).toMatchObject({type: 'RateLimited', agentId: 'agy'});
  });

  it('does not double-emit READY when streaming already includes message_stop', () => {
    const line = JSON.stringify({type: 'message_stop'});
    const events = parseAgyOutput(line, {at: 10});
    const readyCount = events.filter(
      e => e.type === 'AgentAvailabilityChanged' && (e as {availability?: string}).availability === 'READY',
    ).length;
    expect(readyCount).toBe(1);
  });

  it('tolerates completely empty output', () => {
    const events = parseAgyOutput('', {at: 10});
    expect(events).toEqual([]);
  });

  it('tolerates whitespace-only output', () => {
    const events = parseAgyOutput('   \n\n   ', {at: 10});
    expect(events).toEqual([]);
  });

  it('tolerates unknown fields on known event types', () => {
    const line = JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: {type: 'text_delta', text: 'hi'},
      _future: {v: 99, extra: [1, 2, 3]},
    });
    const events = parseAgyOutput(line, {at: 10});
    expect(events).toContainEqual(expect.objectContaining({type: 'AgentStreamDelta', delta: 'hi'}));
  });
});
