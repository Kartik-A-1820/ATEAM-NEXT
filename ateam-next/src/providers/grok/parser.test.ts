import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {parseGrokOutput} from './parser.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('parseGrokOutput', () => {
  it('normalizes completion JSON into a stream delta and READY', () => {
    const events = parseGrokOutput(readFileSync(join(fixtures, 'normal.json'), 'utf8'), {at: 1, taskId: 'T1'});
    expect(events).toContainEqual({type: 'ThinkingSummary', agentId: 'grok', summary: 'Reviewing the request.', at: 1});
    expect(events).toContainEqual({
      type: 'AgentStreamDelta',
      agentId: 'grok',
      taskId: 'T1',
      delta: 'Auth handler should reject expired tokens.',
      at: 1,
    });
    expect(events.at(-1)).toMatchObject({type: 'AgentAvailabilityChanged', agentId: 'grok', availability: 'READY'});
  });

  it('does not treat usage fields as a rate limit', () => {
    const events = parseGrokOutput(readFileSync(join(fixtures, 'normal.json'), 'utf8'), {at: 1});
    expect(events.some(event => event.type === 'RateLimited')).toBe(false);
  });

  it('normalizes auth and rate-limit failures', () => {
    expect(parseGrokOutput(readFileSync(join(fixtures, 'auth_failure.json'), 'utf8'), {at: 1})[0]).toMatchObject({
      type: 'AgentAvailabilityChanged',
      agentId: 'grok',
      availability: 'AUTH_ERROR',
    });
    expect(parseGrokOutput(readFileSync(join(fixtures, 'rate_limit.json'), 'utf8'), {at: 1})[0]).toMatchObject({
      type: 'RateLimited',
      agentId: 'grok',
    });
    expect(parseGrokOutput(readFileSync(join(fixtures, 'auth_failure.json'), 'utf8'), {at: 1}).some(event => {
      return event.type === 'AgentAvailabilityChanged' && event.availability === 'READY';
    })).toBe(false);
  });

  it('survives malformed lines and unknown future fields', () => {
    const events = parseGrokOutput(readFileSync(join(fixtures, 'malformed.jsonl'), 'utf8'), {at: 1});
    expect(events.some(event => event.type === 'RuntimeError')).toBe(true);
    expect(events.some(event => event.type === 'AgentStreamDelta' && event.delta === 'after')).toBe(true);
  });

  it('emits READY for unknown-only JSON objects', () => {
    const events = parseGrokOutput(JSON.stringify({futureField: true, nested: {ok: 1}}), {at: 1});
    expect(events).toEqual([{type: 'AgentAvailabilityChanged', agentId: 'grok', availability: 'READY', at: 1}]);
  });

  it('maps wholly malformed JSON to RuntimeError', () => {
    expect(parseGrokOutput('{not json', {at: 1})).toEqual([
      {type: 'RuntimeError', message: 'Grok emitted malformed JSON', at: 1},
    ]);
  });
});
