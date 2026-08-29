import React from 'react';
import {describe, expect, it} from 'vitest';
import {render} from 'ink-testing-library';
import {App} from './App.js';

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
});
