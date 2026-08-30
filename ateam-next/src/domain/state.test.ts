import {describe, expect, it} from 'vitest';
import {initialState, reduce, visibleEntries} from './state.js';

describe('state reducer', () => {
  it('updates canonical state from events', () => {
    let state = initialState();
    state = reduce(state, {type: 'UserMessageReceived', message: 'Refactor auth', at: 1});
    state = reduce(state, {type: 'AgentAvailabilityChanged', agentId: 'claude', availability: 'BUSY', version: '2.1.226', at: 2});
    state = reduce(state, {type: 'TaskCreated', taskId: 'T1', objective: 'review auth', assignedAgent: 'claude', at: 3});
    state = reduce(state, {type: 'TaskStatusChanged', taskId: 'T1', status: 'RUNNING', at: 4});
    expect(state.agents.claude.availability).toBe('BUSY');
    expect(state.agents.claude.version).toBe('2.1.226');
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

  it('tracks pipeline phase and can clear conversation', () => {
    let state = initialState();
    state = reduce(state, {type: 'PipelinePhaseChanged', phase: 'IMPLEMENT', at: 1});
    state = reduce(state, {type: 'PlanUpdated', summary: 'Parallel implementation wave', at: 2});
    expect(state.pipelinePhase).toBe('IMPLEMENT');
    expect(state.planSummary).toBe('Parallel implementation wave');

    state = reduce(state, {type: 'ConversationCleared', at: 3});
    expect(state.conversation).toHaveLength(0);
    state = reduce(state, {type: 'PipelinePhaseChanged', phase: 'IDLE', at: 4});
    expect(state.pipelinePhase).toBe('IDLE');
  });

  it('filters conversation by verbosity', () => {
    let state = initialState();
    state = reduce(state, {type: 'ThinkingSummary', agentId: 'agy', summary: 'deep thought', at: 1});
    expect(visibleEntries(state).some(entry => entry.text.includes('deep thought'))).toBe(false);
    state = reduce(state, {type: 'VerbosityChanged', verbosity: 'VERBOSE', at: 2});
    state = reduce(state, {type: 'ThinkingSummary', agentId: 'agy', summary: 'deep thought', at: 3});
    expect(visibleEntries(state).some(entry => entry.text.includes('deep thought'))).toBe(true);
  });

  it('records rate limit and auth errors on agents', () => {
    let state = initialState();
    state = reduce(state, {type: 'RateLimited', agentId: 'grok', resetHint: 'retry in 60s', at: 1});
    expect(state.agents.grok.availability).toBe('RATE_LIMITED');
    state = reduce(state, {type: 'AgentAvailabilityChanged', agentId: 'agy', availability: 'AUTH_ERROR', reason: 'token expired', at: 2});
    expect(state.agents.agy.availability).toBe('AUTH_ERROR');
  });

  it('does not treat merely ready planned tasks as active execution', () => {
    let state = initialState();
    state = reduce(state, {type: 'TaskCreated', taskId: 'P-T1', objective: 'plan', assignedAgent: 'claude', at: 1});
    expect(state.running).toBe(false);

    state = reduce(state, {type: 'TaskStatusChanged', taskId: 'P-T1', status: 'RUNNING', at: 2});
    expect(state.running).toBe(true);
  });

  it('keeps AgentStreamDelta entries separate when the same agent streams two tasks', () => {
    let state = initialState();
    state = reduce(state, {type: 'AgentStreamDelta', agentId: 'codex', taskId: 'T1', delta: 'first task ', at: 1});
    state = reduce(state, {type: 'AgentStreamDelta', agentId: 'codex', taskId: 'T2', delta: 'second task', at: 2});
    const agentEntries = state.conversation.filter(item => item.speaker === 'codex');
    expect(agentEntries).toHaveLength(2);
    expect(agentEntries[0]?.text).toBe('first task ');
    expect(agentEntries[1]?.text).toBe('second task');
    expect(agentEntries[0]?.taskId).toBe('T1');
    expect(agentEntries[1]?.taskId).toBe('T2');
  });

  it('concatenates AgentStreamDelta events for the same agent and task', () => {
    let state = initialState();
    state = reduce(state, {type: 'AgentStreamDelta', agentId: 'claude', taskId: 'T1', delta: 'Hello ', at: 1});
    state = reduce(state, {type: 'AgentStreamDelta', agentId: 'claude', taskId: 'T1', delta: 'world', at: 2});
    const agentEntries = state.conversation.filter(item => item.speaker === 'claude');
    expect(agentEntries).toHaveLength(1);
    expect(agentEntries[0]?.text).toBe('Hello world');
    expect(agentEntries[0]?.taskId).toBe('T1');
  });

  it('starts a new conversation entry after a task leaves RUNNING', () => {
    let state = initialState();
    state = reduce(state, {type: 'TaskCreated', taskId: 'T1', objective: 'implement', assignedAgent: 'codex', at: 1});
    state = reduce(state, {type: 'AgentStreamDelta', agentId: 'codex', taskId: 'T1', delta: 'old output', at: 2});
    state = reduce(state, {type: 'TaskStatusChanged', taskId: 'T1', status: 'COMPLETED', at: 3});
    state = reduce(state, {type: 'TaskCreated', taskId: 'T2', objective: 'review', assignedAgent: 'codex', at: 4});
    state = reduce(state, {type: 'AgentStreamDelta', agentId: 'codex', taskId: 'T2', delta: 'new output', at: 5});
    const agentEntries = state.conversation.filter(item => item.speaker === 'codex');
    expect(agentEntries).toHaveLength(2);
    expect(agentEntries[0]?.text).toBe('old output');
    expect(agentEntries[1]?.text).toBe('new output');
    expect(agentEntries[0]?.taskId).toBe('T1');
    expect(agentEntries[1]?.taskId).toBe('T2');
  });

  it('starts a new conversation entry when the same task streams again after leaving RUNNING', () => {
    let state = initialState();
    state = reduce(state, {type: 'TaskCreated', taskId: 'T1', objective: 'implement', assignedAgent: 'codex', at: 1});
    state = reduce(state, {type: 'AgentStreamDelta', agentId: 'codex', taskId: 'T1', delta: 'first attempt', at: 2});
    state = reduce(state, {type: 'TaskStatusChanged', taskId: 'T1', status: 'FAILED', at: 3});
    state = reduce(state, {type: 'AgentStreamDelta', agentId: 'codex', taskId: 'T1', delta: 'retry output', at: 4});
    const agentEntries = state.conversation.filter(item => item.speaker === 'codex');
    expect(agentEntries).toHaveLength(2);
    expect(agentEntries[0]?.text).toBe('first attempt');
    expect(agentEntries[1]?.text).toBe('retry output');
  });

  it('reassigns a task to the new agent and surfaces the reason', () => {
    let state = initialState();
    state = reduce(state, {type: 'TaskCreated', taskId: 'P-T2', objective: 'implement', assignedAgent: 'codex', at: 1});
    state = reduce(state, {
      type: 'TaskReassigned',
      taskId: 'P-T2',
      fromAgent: 'codex',
      toAgent: 'claude',
      reason: 'rate limited',
      attempt: 2,
      at: 2,
    });
    expect(state.tasks['P-T2']?.assignedAgent).toBe('claude');
    expect(visibleEntries(state).some(entry => entry.text.includes('reassigned from codex to claude'))).toBe(true);
  });

  it('surfaces agent cooldown entering and clearing at the right verbosity', () => {
    let state = initialState();
    state = reduce(state, {type: 'AgentCooldownChanged', agentId: 'codex', cooldownUntil: Date.now() + 60_000, reason: 'rate limited', at: 1});
    expect(visibleEntries(state).some(entry => entry.text.includes('cooling down'))).toBe(true);

    state = reduce(state, {type: 'AgentCooldownChanged', agentId: 'codex', cooldownUntil: undefined, reason: 'recovered', at: 2});
    expect(visibleEntries(state).some(entry => entry.text.includes('cooldown cleared'))).toBe(false);
    state = reduce(state, {type: 'VerbosityChanged', verbosity: 'VERBOSE', at: 3});
    state = reduce(state, {type: 'AgentCooldownChanged', agentId: 'codex', cooldownUntil: undefined, reason: 'recovered', at: 4});
    expect(visibleEntries(state).some(entry => entry.text.includes('cooldown cleared'))).toBe(true);
  });

  it('tracks which task an agent is currently on, clearing it when the task leaves RUNNING', () => {
    let state = initialState();
    state = reduce(state, {type: 'TaskCreated', taskId: 'P-T2', objective: 'implement auth', at: 1});
    state = reduce(state, {type: 'TaskAssigned', taskId: 'P-T2', agentId: 'codex', reason: 'implementation score=120', at: 2});
    expect(state.agents.codex.currentTaskId).toBe('P-T2');
    expect(state.agents.codex.currentTaskObjective).toBe('implement auth');

    state = reduce(state, {type: 'TaskStatusChanged', taskId: 'P-T2', status: 'COMPLETED', at: 3});
    expect(state.agents.codex.currentTaskId).toBeUndefined();
    expect(state.agents.codex.currentTaskObjective).toBeUndefined();
  });

  it('moves the current-task pointer to the new agent on reassignment', () => {
    let state = initialState();
    state = reduce(state, {type: 'TaskCreated', taskId: 'P-T2', objective: 'implement auth', at: 1});
    state = reduce(state, {type: 'TaskAssigned', taskId: 'P-T2', agentId: 'codex', reason: 'implementation score=120', at: 2});
    state = reduce(state, {
      type: 'TaskReassigned',
      taskId: 'P-T2',
      fromAgent: 'codex',
      toAgent: 'claude',
      reason: 'rate limited',
      attempt: 2,
      at: 3,
    });
    expect(state.agents.codex.currentTaskId).toBeUndefined();
    expect(state.agents.claude.currentTaskId).toBe('P-T2');
    expect(state.agents.claude.currentTaskObjective).toBe('implement auth');
  });

  it('records per-task attempt history across assignment and reassignment', () => {
    let state = initialState();
    state = reduce(state, {type: 'TaskCreated', taskId: 'P-T2', objective: 'implement auth', at: 1});
    state = reduce(state, {type: 'TaskAssigned', taskId: 'P-T2', agentId: 'codex', reason: 'implementation score=120', at: 2});
    state = reduce(state, {
      type: 'TaskReassigned',
      taskId: 'P-T2',
      fromAgent: 'codex',
      toAgent: 'claude',
      reason: 'rate limited',
      attempt: 2,
      at: 3,
    });
    expect(state.tasks['P-T2'].attempts).toEqual([
      {agentId: 'codex', reason: 'implementation score=120', at: 2},
      {agentId: 'claude', reason: 'rate limited', at: 3},
    ]);
  });

  it('surfaces a cooldown countdown on the agent itself, clearing it when cooldown ends', () => {
    let state = initialState();
    state = reduce(state, {type: 'AgentCooldownChanged', agentId: 'grok', cooldownUntil: 5000, reason: 'rate limited', at: 1});
    expect(state.agents.grok.cooldownUntil).toBe(5000);
    expect(state.agents.grok.cooldownReason).toBe('rate limited');

    state = reduce(state, {type: 'AgentCooldownChanged', agentId: 'grok', cooldownUntil: undefined, reason: 'recovered', at: 2});
    expect(state.agents.grok.cooldownUntil).toBeUndefined();
    expect(state.agents.grok.cooldownReason).toBeUndefined();
  });

  it('surfaces a compiled context packet only at TRACE verbosity', () => {
    let state = initialState();
    state = reduce(state, {type: 'ContextPacketCompiled', taskId: 'P-T2', agentId: 'codex', packet: 'Task P-T2: implement auth', at: 1});
    expect(visibleEntries(state).some(entry => entry.text.includes('implement auth'))).toBe(false);

    state = reduce(state, {type: 'VerbosityChanged', verbosity: 'TRACE', at: 2});
    expect(visibleEntries(state).some(entry => entry.text.includes('implement auth'))).toBe(true);
  });
});
