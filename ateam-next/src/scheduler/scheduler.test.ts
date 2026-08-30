import {describe, expect, it} from 'vitest';
import {initialState} from '../domain/state.js';
import {createInitialTaskGraph} from '../planner/taskGraph.js';
import {scheduleTask} from './scheduler.js';

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
});
