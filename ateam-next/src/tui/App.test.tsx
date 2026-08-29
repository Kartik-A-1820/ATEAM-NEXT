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
});
