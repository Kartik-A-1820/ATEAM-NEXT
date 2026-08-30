import React from 'react';
import {describe, expect, it} from 'vitest';
import {render} from 'ink-testing-library';
import type {ConversationEntry} from '../domain/types.js';
import {initialState} from '../domain/state.js';
import {ConversationView} from './ConversationView.js';
import {TOOL_CALL_MARKER} from './format.js';

function entry(speaker: ConversationEntry['speaker'], text: string, id = 'e1'): ConversationEntry {
  return {id, speaker, text, time: 1, level: 'NORMAL'};
}

function frameOf(entries: ConversationEntry[]): string {
  const state = initialState(80, 20);
  const {lastFrame, unmount} = render(
    <ConversationView state={state} entries={entries} width={80} height={12} />,
  );
  const frame = lastFrame() ?? '';
  unmount();
  return frame;
}

describe('ConversationView markdown-lite', () => {
  it('renders agent bold and code spans without the markdown markers', () => {
    const frame = frameOf([entry('codex', 'Use **bold** and `code` here')]);
    expect(frame).toContain('bold');
    expect(frame).toContain('code');
    expect(frame).not.toContain('**');
    expect(frame).not.toContain('`code`');
  });

  it('does not markdown-parse user entries', () => {
    const frame = frameOf([entry('You', 'keep **stars** and `ticks`')]);
    expect(frame).toContain('**stars**');
    expect(frame).toContain('`ticks`');
  });

  it('renders agent bullet lines with a bullet marker', () => {
    const frame = frameOf([entry('claude', '- first item')]);
    expect(frame).toContain('• first item');
    expect(frame).not.toContain('- first item');
  });
});

describe('ConversationView tool-call cards', () => {
  it('prefixes ToolStarted and ToolFinished lines with a marker', () => {
    const frame = frameOf([
      entry('codex', 'started tool simulated-shell', 't1'),
      entry('codex', 'finished simulated-shell: exit 0', 't2'),
    ]);
    expect(frame).toContain(`${TOOL_CALL_MARKER} started tool simulated-shell`);
    expect(frame).toContain(`${TOOL_CALL_MARKER} finished simulated-shell: exit 0`);
  });

  it('does not treat ThinkingSummary lines as tool-call cards', () => {
    const frame = frameOf([entry('codex', 'thinking: considering options')]);
    expect(frame).toContain('thinking: considering options');
    expect(frame).not.toContain(`${TOOL_CALL_MARKER} thinking:`);
  });
});
