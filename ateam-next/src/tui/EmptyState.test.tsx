import React from 'react';
import {describe, expect, it} from 'vitest';
import {render} from 'ink-testing-library';
import type {AgentAvailability, AgentId, AppState} from '../domain/types.js';
import {EmptyState, shouldShowEmptyState} from './EmptyState.js';

describe('EmptyState', () => {
  it('shows before first input when every agent is unconfigured', () => {
    expect(shouldShowEmptyState(stateWithAvailability('NOT_CONFIGURED'))).toBe(true);
  });

  it('does not show for configured but temporarily unavailable agents', () => {
    expect(shouldShowEmptyState(stateWithAvailability('RATE_LIMITED'))).toBe(false);
    expect(shouldShowEmptyState(stateWithAvailability('UNHEALTHY'))).toBe(false);
  });

  it('does not show after conversation has started', () => {
    const state = stateWithAvailability('NOT_INSTALLED');
    expect(shouldShowEmptyState({
      ...state,
      conversation: [
        ...state.conversation,
        {id: 'm2', speaker: 'You', text: 'Build this', time: 2, level: 'QUIET'},
      ],
    })).toBe(false);
  });

  it('renders setup guidance', () => {
    const {lastFrame, unmount} = render(<EmptyState state={stateWithAvailability('UNKNOWN')} height={8} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('No agents are ready yet.');
    expect(frame).toContain('/doctor');
    expect(frame).toContain('Codex, Claude, AGY, or Grok');
    unmount();
  });
});

function stateWithAvailability(availability: AgentAvailability): AppState {
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
      codex: agent('codex', 'Codex', 'green', availability),
      claude: agent('claude', 'Claude', 'yellow', availability),
      agy: agent('agy', 'AGY', 'cyan', availability),
      grok: agent('grok', 'Grok', 'magenta', availability),
    },
    conversation: [{id: 'm1', speaker: 'System', text: 'Ready.', time: 1, level: 'NORMAL'}],
    tasks: {},
    running: false,
    quitting: false,
    log: [],
    openStreams: {},
  };
}

function agent(id: AgentId, displayName: string, color: AppState['agents'][AgentId]['color'], availability: AgentAvailability): AppState['agents'][AgentId] {
  return {
    id,
    displayName,
    color,
    availability,
    installed: false,
    authenticated: 'UNKNOWN',
    runningTaskCount: 0,
  };
}
