import {describe, expect, it} from 'vitest';
import type {ConversationEntry} from '../domain/types.js';
import {
  classifyConversationLine,
  formatCooldownCountdown,
  isAgentProseEntry,
  isDimLine,
  isToolCallLine,
} from './format.js';

function entry(text: string, speaker: ConversationEntry['speaker'] = 'codex'): ConversationEntry {
  return {id: '1', speaker, text, time: 0, level: 'NORMAL'};
}

describe('classifyConversationLine', () => {
  it('classifies ThinkingSummary-derived lines', () => {
    expect(classifyConversationLine(entry('thinking: considering the tests'))).toBe('thinking');
    expect(isToolCallLine(entry('thinking: considering the tests'))).toBe(false);
  });

  it('classifies ToolStarted-derived lines', () => {
    const started = entry('started tool simulated-shell');
    expect(classifyConversationLine(started)).toBe('tool-call');
    expect(isToolCallLine(started)).toBe(true);
  });

  it('classifies ToolFinished-derived lines', () => {
    const finished = entry('finished simulated-shell: exit 0');
    expect(classifyConversationLine(finished)).toBe('tool-call');
    expect(isToolCallLine(finished)).toBe(true);
  });

  it('leaves agent prose and user text as plain', () => {
    expect(classifyConversationLine(entry('Use **bold** here'))).toBe('plain');
    expect(classifyConversationLine(entry('please started tool later', 'You'))).toBe('plain');
    expect(classifyConversationLine(entry('finished the refactor yesterday'))).toBe('plain');
  });
});

describe('isDimLine', () => {
  it('dims thinking and started-tool lines, but not finished-tool lines', () => {
    expect(isDimLine(entry('thinking: wait'))).toBe(true);
    expect(isDimLine(entry('started tool shell'))).toBe(true);
    expect(isDimLine(entry('finished shell: exit 0'))).toBe(false);
    expect(isDimLine(entry('hello'))).toBe(false);
  });
});

describe('isAgentProseEntry', () => {
  it('is true only for agent-authored stream text', () => {
    expect(isAgentProseEntry(entry('Use `code`', 'codex'))).toBe(true);
    expect(isAgentProseEntry(entry('Use `code`', 'You'))).toBe(false);
    expect(isAgentProseEntry(entry('Plan updated', 'Ateam'))).toBe(false);
    expect(isAgentProseEntry(entry('Permission requested', 'System'))).toBe(false);
    expect(isAgentProseEntry(entry('thinking: wait', 'codex'))).toBe(false);
    expect(isAgentProseEntry(entry('started tool shell', 'codex'))).toBe(false);
    expect(isAgentProseEntry(entry('finished shell: ok', 'codex'))).toBe(false);
  });
});

describe('formatCooldownCountdown', () => {
  it('formats minutes and seconds remaining', () => {
    expect(formatCooldownCountdown(252_000, 0)).toBe('4m 12s left');
  });

  it('formats seconds-only when under a minute', () => {
    expect(formatCooldownCountdown(30_000, 0)).toBe('30s left');
  });

  it('returns undefined once the cooldown has passed', () => {
    expect(formatCooldownCountdown(1000, 2000)).toBeUndefined();
  });

  it('returns undefined when there is no cooldown', () => {
    expect(formatCooldownCountdown(undefined, 0)).toBeUndefined();
  });
});
