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
});
