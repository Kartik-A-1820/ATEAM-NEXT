import React from 'react';
import {describe, expect, it} from 'vitest';
import {render} from 'ink-testing-library';
import type {AgentAvailability, AgentId, AgentState, AppState, ConversationEntry} from '../domain/types.js';
import {
  classifyConversationLine,
  formatAgentBadgeStatus,
  formatAgentGlance,
  formatCooldownCountdown,
  isAgentProseEntry,
  isDimLine,
  isToolCallLine,
} from './format.js';
import {Header} from './Header.js';
import {StatusBar} from './StatusBar.js';

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

describe('formatAgentBadgeStatus', () => {
  it('keeps the availability name when the agent is idle', () => {
    expect(formatAgentBadgeStatus({availability: 'READY', runningTaskCount: 0})).toBe('READY');
  });

  it('appends a truncated objective snippet for a running agent', () => {
    const status = formatAgentBadgeStatus({
      availability: 'READY',
      runningTaskCount: 1,
      currentTaskObjective: 'implement authentication middleware for the session store',
    });
    expect(status).toContain('READY ×1');
    expect(status).toContain('implement');
    expect(status).toContain('...');
    expect(status.length).toBeLessThan(40);
  });

  it('shows cooling countdown instead of the availability enum name', () => {
    expect(formatAgentBadgeStatus({
      availability: 'COOLDOWN',
      runningTaskCount: 0,
      cooldownUntil: 252_000,
    }, 0)).toBe('cooling 4m 12s');
  });

  it('keeps unavailable statuses concise', () => {
    expect(formatAgentBadgeStatus({availability: 'NOT_INSTALLED', runningTaskCount: 0})).toBe('NOT_INSTALLED');
    expect(formatAgentBadgeStatus({availability: 'DISABLED', runningTaskCount: 0})).toBe('DISABLED');
  });

  it('prefers the running-task marker over cooldown text', () => {
    expect(formatAgentBadgeStatus({
      availability: 'COOLDOWN',
      runningTaskCount: 2,
      currentTaskObjective: 'review',
      cooldownUntil: 252_000,
    }, 0)).toBe('COOLDOWN ×2 review');
  });
});

describe('formatAgentGlance', () => {
  it('omits idle and unavailable agents from the status-bar glance', () => {
    expect(formatAgentGlance({displayName: 'Codex', availability: 'READY', runningTaskCount: 0})).toBeUndefined();
    expect(formatAgentGlance({displayName: 'AGY', availability: 'NOT_INSTALLED', runningTaskCount: 0})).toBeUndefined();
  });

  it('includes running and cooling agents', () => {
    expect(formatAgentGlance({
      displayName: 'Codex',
      availability: 'READY',
      runningTaskCount: 1,
      currentTaskObjective: 'fix auth',
    })).toBe('Codex READY ×1 fix auth');
    expect(formatAgentGlance({
      displayName: 'Grok',
      availability: 'RATE_LIMITED',
      runningTaskCount: 0,
      cooldownUntil: 252_000,
    }, 0)).toBe('Grok cooling 4m 12s');
  });
});

describe('Header badges', () => {
  it('renders a running objective snippet and a cooling countdown', () => {
    const {lastFrame, unmount} = render(React.createElement(Header, {state: headerState()}));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Codex READY ×1 fix auth');
    expect(frame).toContain('Grok cooling 4m 12s');
    expect(frame).toContain('AGY NOT_INSTALLED');
    expect(frame).toContain('Claude READY');
    unmount();
  });
});

describe('StatusBar glance', () => {
  it('shows running and cooling agents without duplicating idle badges', () => {
    const {lastFrame, unmount} = render(React.createElement(StatusBar, {state: headerState()}));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Codex READY ×1 fix auth');
    expect(frame).toContain('Grok cooling 4m 12s');
    expect(frame).not.toContain('Claude READY');
    expect(frame).not.toContain('AGY NOT_INSTALLED');
    unmount();
  });
});

function headerState(): AppState {
  return {
    sessionId: 'test',
    startedAt: 1,
    width: 100,
    height: 30,
    activeTab: 'Plan',
    verbosity: 'NORMAL',
    permissionMode: 'STANDARD',
    pipelinePhase: 'IDLE',
    agents: {
      codex: badgeAgent('codex', 'Codex', 'green', 'READY', {runningTaskCount: 1, currentTaskObjective: 'fix auth'}),
      claude: badgeAgent('claude', 'Claude', 'yellow', 'READY'),
      agy: badgeAgent('agy', 'AGY', 'cyan', 'NOT_INSTALLED'),
      grok: badgeAgent('grok', 'Grok', 'magenta', 'RATE_LIMITED', {cooldownUntil: Date.now() + 252_000}),
    },
    conversation: [],
    tasks: {},
    running: true,
    quitting: false,
    log: [],
    openStreams: {},
  };
}

function badgeAgent(
  id: AgentId,
  displayName: string,
  color: AgentState['color'],
  availability: AgentAvailability,
  extra: Partial<Pick<AgentState, 'runningTaskCount' | 'currentTaskObjective' | 'cooldownUntil'>> = {},
): AgentState {
  return {
    id,
    displayName,
    color,
    availability,
    installed: true,
    authenticated: 'UNKNOWN',
    runningTaskCount: 0,
    ...extra,
  };
}
