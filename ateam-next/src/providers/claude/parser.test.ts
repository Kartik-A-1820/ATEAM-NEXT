import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {classifyClaudeFailure, parseClaudeOutput} from './parser.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('parseClaudeOutput', () => {
  it('normalizes completion JSON', () => {
    const events = parseClaudeOutput(readFileSync(join(fixtures, 'completion.json'), 'utf8'), {at: 1, taskId: 'T1'});
    expect(events).toContainEqual({type: 'AgentStreamDelta', agentId: 'claude', taskId: 'T1', delta: 'Claude completed the assigned review.', at: 1});
    expect(events.at(-1)).toMatchObject({type: 'AgentAvailabilityChanged', availability: 'READY'});
  });

  it('normalizes JSONL streams and tools', () => {
    const events = parseClaudeOutput(readFileSync(join(fixtures, 'streaming.jsonl'), 'utf8'), {at: 2});
    expect(events.filter(event => event.type === 'AgentStreamDelta').map(event => event.delta)).toEqual(['First ', 'second']);
    expect(events.some(event => event.type === 'ToolStarted')).toBe(true);
    expect(events.some(event => event.type === 'ToolFinished')).toBe(true);
  });

  it('normalizes auth and rate limit failures', () => {
    expect(parseClaudeOutput(readFileSync(join(fixtures, 'auth_failure.jsonl'), 'utf8'), {at: 3})[0]).toMatchObject({type: 'AgentAvailabilityChanged', availability: 'AUTH_ERROR'});
    expect(parseClaudeOutput(readFileSync(join(fixtures, 'rate_limit.jsonl'), 'utf8'), {at: 4})[0]).toMatchObject({type: 'RateLimited', agentId: 'claude'});
  });

  it('survives malformed JSONL lines', () => {
    const events = parseClaudeOutput(readFileSync(join(fixtures, 'malformed.jsonl'), 'utf8'), {at: 5});
    expect(events.some(event => event.type === 'RuntimeError')).toBe(true);
    expect(events.filter(event => event.type === 'AgentStreamDelta')).toHaveLength(2);
  });
});

describe('classifyClaudeFailure', () => {
  it('classifies plain text auth and rate limit failures', () => {
    expect(classifyClaudeFailure('login required', 1, 1)[0]).toMatchObject({type: 'AgentAvailabilityChanged', availability: 'AUTH_ERROR'});
    expect(classifyClaudeFailure('too many requests', 1, 1)[0]).toMatchObject({type: 'RateLimited', agentId: 'claude'});
  });
});
