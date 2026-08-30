import React from 'react';
import {describe, expect, it} from 'vitest';
import {render} from 'ink-testing-library';
import {InputBox} from './InputBox.js';

describe('InputBox autocomplete', () => {
  it('lists matching slash commands under the input', async () => {
    const {lastFrame, stdin, unmount} = render(<InputBox onSubmit={() => undefined} />);
    stdin.write('/sta');
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(lastFrame()).toContain('/sta');
    expect(lastFrame()).toContain('status');
    unmount();
  });

  it('lists agent ids after an agent: fragment', async () => {
    const {lastFrame, stdin, unmount} = render(<InputBox onSubmit={() => undefined} />);
    stdin.write('/stop agent:');
    await new Promise(resolve => setTimeout(resolve, 20));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('codex');
    expect(frame).toContain('claude');
    expect(frame).toContain('agy');
    expect(frame).toContain('grok');
    unmount();
  });
});
