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

  it('renders context and diff empty states from slash navigation', async () => {
    const {lastFrame, stdin, unmount} = render(<App simulate={true} scenario="FAST" />);
    stdin.write('/diff\r');
    await new Promise(resolve => setTimeout(resolve, 20));
    // DiffView now shells out to real `git diff` and starts in a loading state;
    // 20ms is well under real subprocess latency, so this is deterministic.
    expect(lastFrame()).toContain('Loading diff...');
    stdin.write('/context\r');
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(lastFrame()).toContain('latest user instruction always supersedes the active plan.');
    unmount();
  });

  it('renders all four agent names in the header', () => {
    const {lastFrame, unmount} = render(<App simulate={true} scenario="FAST" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Codex');
    expect(frame).toContain('Claude');
    expect(frame).toContain('AGY');
    expect(frame).toContain('Grok');
    expect(frame).toContain('STANDARD');
    unmount();
  });

  it('switches to Agents and Tasks tabs after slash commands', async () => {
    const {lastFrame, stdin, unmount} = render(<App simulate={true} scenario="FAST" />);
    stdin.write('/agents\r');
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(lastFrame()).toContain('[Agents]');
    stdin.write('/tasks\r');
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(lastFrame()).toContain('[Tasks]');
    unmount();
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
    pipelinePhase: 'IDLE' as const,
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
