import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe, expect, it} from 'vitest';
import {AteamStore} from './store.js';

describe('AteamStore', () => {
  it('creates sessions and persists canonical events', () => {
    const store = new AteamStore(join(mkdtempSync(join(tmpdir(), 'ateam-store-')), 'test.sqlite'));
    store.createSession('s1', 'Test session', 1);
    store.appendEvent('s1', {type: 'UserMessageReceived', message: 'hello', at: 2});
    store.appendEvent('s1', {type: 'PlanUpdated', summary: 'plan', at: 3});

    expect(store.listSessions()[0]).toMatchObject({id: 's1', title: 'Test session'});
    expect(store.latestSession()?.id).toBe('s1');
    expect(store.eventsForSession('s1').map(item => item.event.type)).toEqual(['UserMessageReceived', 'PlanUpdated']);
    store.close();
  });
});
