import React from 'react';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe, expect, it} from 'vitest';
import {render} from 'ink-testing-library';
import {App} from './App.js';
import {AteamStore} from '../storage/store.js';

describe('App TUI', () => {
  it('renders agent indicators and input prompt', () => {
    const {lastFrame, unmount} = render(<App simulate={true} scenario="FAST" />);
    expect(lastFrame()).toContain('ATEAM');
    expect(lastFrame()).toContain('Codex READY');
    expect(lastFrame()).toContain('>');
    unmount();
  });

  it('submits slash commands through the TUI input path', async () => {
    const {lastFrame, stdin, unmount} = render(<App simulate={true} scenario="FAST" />);
    stdin.write('/verbosity trace\r');
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(lastFrame()).toContain('TRACE');
    unmount();
  });

  it('persists interactive events when a store is supplied', async () => {
    const store = new AteamStore(join(mkdtempSync(join(tmpdir(), 'ateam-tui-store-')), 'test.sqlite'));
    const {stdin, unmount} = render(<App simulate={true} scenario="FAST" store={store} />);
    await new Promise(resolve => setTimeout(resolve, 20));
    stdin.write('Persist this session\r');
    await new Promise(resolve => setTimeout(resolve, 100));
    unmount();

    const session = store.latestSession();
    expect(session?.title).toBe('Interactive simulated session');
    expect(session ? store.messagesForSession(session.id).some(message => message.text === 'Persist this session') : false).toBe(true);
    store.close();
  });

  it('renders replayed state for interactive resume', () => {
    const initial = {
      ...AppInitialState(),
      conversation: [{id: 'm1', speaker: 'You' as const, text: 'Previously saved task', time: 1, level: 'QUIET' as const}],
    };
    const {lastFrame, unmount} = render(<App simulate={true} scenario="FAST" initial={initial} sessionMode="resume" />);
    expect(lastFrame()).toContain('Previously saved task');
    unmount();
  });
});

function AppInitialState() {
  return {
    sessionId: 'resume-test',
    startedAt: 1,
    width: 100,
    height: 30,
    activeTab: 'Plan' as const,
    verbosity: 'NORMAL' as const,
    permissionMode: 'STANDARD' as const,
    agents: {
      codex: {id: 'codex' as const, displayName: 'Codex', color: 'green' as const, availability: 'READY' as const, installed: true, authenticated: 'UNKNOWN' as const, runningTaskCount: 0},
      claude: {id: 'claude' as const, displayName: 'Claude', color: 'yellow' as const, availability: 'READY' as const, installed: true, authenticated: 'UNKNOWN' as const, runningTaskCount: 0},
      agy: {id: 'agy' as const, displayName: 'AGY', color: 'cyan' as const, availability: 'READY' as const, installed: true, authenticated: 'UNKNOWN' as const, runningTaskCount: 0},
      grok: {id: 'grok' as const, displayName: 'Grok', color: 'magenta' as const, availability: 'READY' as const, installed: true, authenticated: 'UNKNOWN' as const, runningTaskCount: 0},
    },
    tasks: {},
    running: false,
    quitting: false,
    log: [],
  };
}
