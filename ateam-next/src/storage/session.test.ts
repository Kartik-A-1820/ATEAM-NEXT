import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe, expect, it} from 'vitest';
import {AteamStore} from './store.js';
import {formatSessionList, replaySession} from './session.js';

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
});
