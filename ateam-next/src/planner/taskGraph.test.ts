import {describe, expect, it} from 'vitest';
import {applyConstraint, createInitialTaskGraph, readyTasks} from './taskGraph.js';

describe('task graph', () => {
  it('selects dependency-ready tasks deterministically', () => {
    const graph = createInitialTaskGraph('Fix auth');
    expect(readyTasks(graph).map(task => task.id)).toEqual(['T1']);
    graph.tasks[0].status = 'COMPLETED';
    expect(readyTasks(graph).map(task => task.id)).toEqual(['T2']);
  });

  it('invalidates running implementation when a new constraint arrives', () => {
    const graph = createInitialTaskGraph('Fix auth');
    graph.tasks[1].status = 'RUNNING';
    const updated = applyConstraint(graph, 'Do not change public interface');
    expect(updated.constraints).toContain('Do not change public interface');
    expect(updated.tasks[1].status).toBe('INVALIDATED');
  });
});
