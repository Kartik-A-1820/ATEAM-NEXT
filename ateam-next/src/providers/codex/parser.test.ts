import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {classifyCodexFailureText, parseCodexJsonl} from './parser.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('parseCodexJsonl', () => {
  it('normalizes streaming and tool events', () => {
    const events = parseCodexJsonl(readFileSync(join(fixtures, 'normal.jsonl'), 'utf8'), {at: 1, taskId: 'T1'});
    expect(events).toContainEqual({type: 'AgentStreamDelta', agentId: 'codex', taskId: 'T1', delta: 'Hello ', at: 1});
    expect(events.some(event => event.type === 'ToolStarted')).toBe(true);
    expect(events.at(-1)).toMatchObject({type: 'AgentAvailabilityChanged', availability: 'READY'});
  });

  it('normalizes auth and rate-limit failures', () => {
    expect(parseCodexJsonl(readFileSync(join(fixtures, 'auth_failure.jsonl'), 'utf8'), {at: 1})[0]).toMatchObject({type: 'AgentAvailabilityChanged', availability: 'AUTH_ERROR'});
    expect(parseCodexJsonl(readFileSync(join(fixtures, 'rate_limit.jsonl'), 'utf8'), {at: 1})[0]).toMatchObject({type: 'RateLimited', agentId: 'codex'});
  });

  it('treats ChatGPT usage-limit stderr as RateLimited with a reset hint', () => {
    const event = classifyCodexFailureText("You've hit your usage limit. Upgrade to Pro or try again at 5:52 PM.");
    expect(event).toMatchObject({type: 'RateLimited', agentId: 'codex', resetHint: '5:52 PM'});
  });

  it('survives malformed and unknown events', () => {
    const events = parseCodexJsonl(readFileSync(join(fixtures, 'malformed.jsonl'), 'utf8'), {at: 1});
    expect(events.some(event => event.type === 'RuntimeError')).toBe(true);
    expect(events.some(event => event.type === 'AgentStreamDelta')).toBe(true);
  });
});
