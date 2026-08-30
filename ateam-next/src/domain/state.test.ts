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

  it('cancels scoped tasks without cancelling unrelated completed work', () => {
    let state = initialState();
    state = reduce(state, {type: 'TaskCreated', taskId: 'T1', objective: 'implement', assignedAgent: 'codex', at: 1});
    state = reduce(state, {type: 'TaskCreated', taskId: 'T2', objective: 'review', assignedAgent: 'claude', at: 2});
    state = reduce(state, {type: 'TaskStatusChanged', taskId: 'T1', status: 'RUNNING', at: 3});
    state = reduce(state, {type: 'TaskStatusChanged', taskId: 'T2', status: 'COMPLETED', at: 4});
    state = reduce(state, {type: 'StopRequested', scope: 'task:T1', at: 5});

    expect(state.tasks.T1.status).toBe('CANCELLED');
    expect(state.tasks.T2.status).toBe('COMPLETED');
  });

  it('tracks selected detail view from canonical events', () => {
    const state = reduce(initialState(), {type: 'ViewChanged', tab: 'Agents', at: 1});
    expect(state.activeTab).toBe('Agents');
  });

  it('records task assignment and invalidation events', () => {
    let state = initialState();
    state = reduce(state, {type: 'TaskCreated', taskId: 'T1', objective: 'implement', dependencies: ['T0'], at: 1});
    state = reduce(state, {type: 'TaskAssigned', taskId: 'T1', agentId: 'codex', reason: 'implementation score=120', at: 2});
    state = reduce(state, {type: 'TaskInvalidated', taskId: 'T1', reason: 'new user constraint', at: 3});
    expect(state.tasks.T1.assignedAgent).toBe('codex');
    expect(state.tasks.T1.dependencies).toEqual(['T0']);
    expect(state.tasks.T1.status).toBe('INVALIDATED');
  });

  it('derives agent running task counts from task state', () => {
    let state = initialState();
    state = reduce(state, {type: 'TaskCreated', taskId: 'T1', objective: 'implement', assignedAgent: 'codex', at: 1});
    state = reduce(state, {type: 'TaskStatusChanged', taskId: 'T1', status: 'RUNNING', at: 2});
    expect(state.agents.codex.runningTaskCount).toBe(1);

    state = reduce(state, {type: 'TaskStatusChanged', taskId: 'T1', status: 'COMPLETED', at: 3});
    expect(state.agents.codex.runningTaskCount).toBe(0);
  });

  it('does not treat merely ready planned tasks as active execution', () => {
    let state = initialState();
    state = reduce(state, {type: 'TaskCreated', taskId: 'P-T1', objective: 'plan', assignedAgent: 'claude', at: 1});
    expect(state.running).toBe(false);

    state = reduce(state, {type: 'TaskStatusChanged', taskId: 'P-T1', status: 'RUNNING', at: 2});
    expect(state.running).toBe(true);
  });
});
