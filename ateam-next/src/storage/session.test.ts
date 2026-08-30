import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe, expect, it} from 'vitest';
import {reduceHealthEvents} from '../domain/agentHealth.js';
import {AteamStore} from './store.js';
import {formatSessionList, replaySession, replaySessionHealth} from './session.js';

describe('session helpers', () => {
  it('replays stored events into application state', () => {
    const store = new AteamStore(join(mkdtempSync(join(tmpdir(), 'ateam-replay-')), 'test.sqlite'));
    store.createSession('s1', 'Replay', 1);
    store.appendEvent('s1', {type: 'UserMessageReceived', message: 'hello', at: 2});

    const state = replaySession(store, 's1');
    expect(state?.conversation.some(item => item.text === 'hello')).toBe(true);
    expect(formatSessionList(store.listSessions())).toContain('Replay');
    store.close();
  });

  it('replays stored events into the same health map as reduceHealthEvents', () => {
    const store = new AteamStore(join(mkdtempSync(join(tmpdir(), 'ateam-replay-health-')), 'test.sqlite'));
    store.createSession('s1', 'Health replay', 1);
    const events = [
      {type: 'RateLimited' as const, agentId: 'codex' as const, resetHint: '60s', at: 1_000_000},
      {type: 'AgentAvailabilityChanged' as const, agentId: 'grok' as const, availability: 'AUTH_ERROR' as const, reason: 'not authenticated', at: 1_000_001},
      {type: 'TaskCreated' as const, taskId: 'T1', objective: 'implement', at: 1_000_002},
      {type: 'AgentCooldownChanged' as const, agentId: 'codex' as const, cooldownUntil: 9_999_999, reason: 'derived signal', at: 1_000_003},
    ];
    for (const event of events) {
      store.appendEvent('s1', event);
    }

    expect(replaySessionHealth(store, 's1')).toEqual(reduceHealthEvents(events));
    expect(replaySessionHealth(store, 'missing')).toEqual({});
    store.close();
  });
});
