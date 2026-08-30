import {describe, expect, it} from 'vitest';
import {createAgentHealth, recordTransientFailure} from '../domain/agentHealth.js';
import {initialState} from '../domain/state.js';
import type {AgentId} from '../domain/types.js';
import {createInitialTaskGraph} from '../planner/taskGraph.js';
import {pickAgentForDispatch, scheduleGraph, scheduleTask} from './scheduler.js';

describe('scheduler', () => {
  it('assigns implementation to Codex by deterministic heuristic', () => {
    const state = initialState();
    const task = createInitialTaskGraph('Fix auth').tasks[1];
    expect(scheduleTask(task, state.agents)?.agentId).toBe('codex');
  });

  it('honors review-only restrictions', () => {
    const state = initialState();
    const task = createInitialTaskGraph('Fix auth').tasks[1];
    expect(scheduleTask(task, state.agents, {codex: 'review_only'})?.agentId).not.toBe('codex');
  });

  it('spreads a collaboration graph across all four ready agents', () => {
    const state = initialState();
    const graph = createInitialTaskGraph('Fix auth');
    const assignments = scheduleGraph(graph, state.agents);
    expect(assignments).toHaveLength(6);
    expect(assignments.find(item => item.taskId === 'T1')?.agentId).toBe('grok');
    expect(assignments.find(item => item.taskId === 'T2')?.agentId).toBe('codex');
    expect(assignments.find(item => item.taskId === 'T5')?.agentId).toBe('claude');
    expect(assignments.find(item => item.taskId === 'T6')?.agentId).toBe('agy');
    const implAgents = assignments.filter(item => ['T2', 'T3', 'T4'].includes(item.taskId)).map(item => item.agentId);
    expect(new Set(implAgents).size).toBe(3);
    expect(new Set(assignments.map(item => item.agentId)).size).toBe(4);
  });

  it('returns undefined when no agent is READY', () => {
    const state = initialState();
    const busy = Object.fromEntries(
      Object.entries(state.agents).map(([id, agent]) => [id, {...agent, availability: 'BUSY' as const}]),
    ) as typeof state.agents;
    const task = createInitialTaskGraph('Fix auth').tasks[1];
    expect(scheduleTask(task, busy)).toBeUndefined();
  });

  it('assigns analysis to Grok by capability bias', () => {
    const state = initialState();
    const task = createInitialTaskGraph('Fix auth').tasks[0];
    expect(scheduleTask(task, state.agents)?.agentId).toBe('grok');
  });

  describe('pickAgentForDispatch', () => {
    it('excludes an agent currently on cooldown', () => {
      const state = initialState();
      const task = createInitialTaskGraph('Fix auth').tasks[1];
      const preferred = scheduleTask(task, state.agents)?.agentId;
      const now = 1_000_000;
      const health = {[preferred!]: recordTransientFailure(createAgentHealth(preferred!), {reason: 'rate limited'}, now)};

      const picked = pickAgentForDispatch(task, state.agents, health, new Set(), now);

      expect(picked?.agentId).not.toBe(preferred);
      expect(picked?.agentId).toBeDefined();
    });

    it('re-admits an agent once its cooldown has elapsed', () => {
      const state = initialState();
      const task = createInitialTaskGraph('Fix auth').tasks[1];
      const preferred = scheduleTask(task, state.agents)?.agentId;
      const now = 1_000_000;
      const health = {[preferred!]: recordTransientFailure(createAgentHealth(preferred!), {reason: 'rate limited', resetAtMs: now + 1000}, now)};

      const picked = pickAgentForDispatch(task, state.agents, health, new Set(), now + 2000);

      expect(picked?.agentId).toBe(preferred);
    });

    it('returns undefined when every agent is on cooldown', () => {
      const state = initialState();
      const task = createInitialTaskGraph('Fix auth').tasks[1];
      const now = 1_000_000;
      const health = Object.fromEntries(
        (Object.keys(state.agents) as AgentId[]).map(id => [id, recordTransientFailure(createAgentHealth(id), {reason: 'down'}, now)]),
      );

      expect(pickAgentForDispatch(task, state.agents, health, new Set(), now)).toBeUndefined();
    });
  });
});
