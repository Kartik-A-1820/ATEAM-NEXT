import {describe, expect, it} from 'vitest';
import {initialState, reduce, visibleEntries} from './state.js';

describe('state reducer', () => {
  it('updates canonical state from events', () => {
    let state = initialState();
    state = reduce(state, {type: 'UserMessageReceived', message: 'Refactor auth', at: 1});
    state = reduce(state, {type: 'AgentAvailabilityChanged', agentId: 'claude', availability: 'BUSY', at: 2});
    state = reduce(state, {type: 'TaskCreated', taskId: 'T1', objective: 'review auth', assignedAgent: 'claude', at: 3});
    state = reduce(state, {type: 'TaskStatusChanged', taskId: 'T1', status: 'RUNNING', at: 4});
    expect(state.agents.claude.availability).toBe('BUSY');
    expect(state.tasks.T1.status).toBe('RUNNING');
    expect(visibleEntries(state).some(entry => entry.text === 'Refactor auth')).toBe(true);
  });

  it('applies live steering context updates while work remains active', () => {
    let state = initialState();
    state = reduce(state, {type: 'UserMessageReceived', message: 'Do not change AuthService', at: 1});
    state = reduce(state, {type: 'UserMessageClassified', classification: 'NEW_CONSTRAINT', at: 2});
    expect(state.conversation.at(-1)?.text).toContain('NEW_CONSTRAINT');
  });
});
