import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe, expect, it} from 'vitest';
import {AteamStore} from './store.js';
import {buildGraphStore} from '../knowledge/graph.js';
import type {FileOutline} from '../knowledge/indexer.js';

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

  it('projects messages tasks and memories into queryable tables', () => {
    const store = new AteamStore(join(mkdtempSync(join(tmpdir(), 'ateam-store-')), 'test.sqlite'));
    store.createSession('s1', 'Projection session', 1);
    store.appendEvent('s1', {type: 'UserMessageReceived', message: 'fix auth', at: 2});
    store.appendEvent('s1', {type: 'PlanUpdated', summary: 'Plan created', at: 3});
    store.appendEvent('s1', {type: 'TaskCreated', taskId: 'T1', objective: 'Investigate auth', at: 4});
    store.appendEvent('s1', {type: 'TaskAssigned', taskId: 'T1', agentId: 'codex', reason: 'best fit', at: 5});
    store.appendEvent('s1', {type: 'TaskStatusChanged', taskId: 'T1', status: 'COMPLETED', at: 6});
    store.appendEvent('s1', {
      type: 'MemoryUpdated',
      memoryId: 'M1',
      category: 'USER_CONSTRAINT',
      content: 'Do not change public API',
      verification: 'VERIFIED',
      evidence: ['user instruction'],
      at: 7,
    });

    expect(store.messagesForSession('s1').map(message => [message.speaker, message.text])).toEqual([
      ['You', 'fix auth'],
      ['Ateam', 'Plan created'],
    ]);
    expect(store.tasksForSession('s1')[0]).toMatchObject({id: 'T1', assignedAgent: 'codex', status: 'COMPLETED'});
    expect(store.memoriesForSession('s1')[0]).toMatchObject({
      externalId: 'M1',
      category: 'USER_CONSTRAINT',
      content: 'Do not change public API',
      verificationState: 'VERIFIED',
      evidence: ['user instruction'],
    });
    store.close();
  });

  it('persists and loads knowledge graph outlines', () => {
    const store = new AteamStore(join(mkdtempSync(join(tmpdir(), 'ateam-store-')), 'test.sqlite'));
    const outlines: FileOutline[] = [
      {
        path: 'src/example.ts',
        language: 'typescript',
        symbols: [
          {
            file: 'src/example.ts',
            name: 'example',
            kind: 'function',
            signature: 'export function example(): void { ... }',
            startLine: 3,
            endLine: 5,
            exported: true,
          },
        ],
      },
      {
        path: 'src/empty.ts',
        language: 'typescript',
        symbols: [],
      },
    ];

    store.saveGraphOutlines(outlines);

    const loaded = store.loadGraphOutlines();
    const graph = buildGraphStore(loaded);

    expect(loaded).toEqual([outlines[1], outlines[0]]);
    expect(graph.stats()).toEqual({fileCount: 2, symbolCount: 1});
    expect(graph.allSymbols()).toEqual(outlines[0]?.symbols);
    store.close();
  });
});
