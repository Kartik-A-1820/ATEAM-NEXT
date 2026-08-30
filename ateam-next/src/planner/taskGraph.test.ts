import {describe, expect, it} from 'vitest';
import {applyConstraint, createInitialTaskGraph, pipelinePhaseForTask, readyTasks} from './taskGraph.js';

describe('task graph', () => {
  it('selects dependency-ready tasks deterministically', () => {
    const graph = createInitialTaskGraph('Fix auth');
    expect(readyTasks(graph).map(task => task.id)).toEqual(['T1']);
    graph.tasks[0].status = 'COMPLETED';
    expect(readyTasks(graph).map(task => task.id)).toEqual(['T2', 'T3', 'T4']);
  });

  it('keeps implementation tasks independent after planning', () => {
    const graph = createInitialTaskGraph('Fix auth');
    const impl = graph.tasks.filter(task => task.type === 'implementation');
    expect(impl.map(task => task.id)).toEqual(['T2', 'T3', 'T4']);
    expect(impl.every(task => task.dependencies.length === 1 && task.dependencies[0] === 'T1')).toBe(true);
    expect(impl.some(task => task.dependencies.includes('T2'))).toBe(false);
  });

  it('unlocks review and verification together after implementation', () => {
    const graph = createInitialTaskGraph('Fix auth');
    for (const task of graph.tasks) {
      if (task.type === 'analysis' || task.type === 'implementation') task.status = 'COMPLETED';
    }
    expect(readyTasks(graph).map(task => task.id)).toEqual(['T6', 'T5']);
    expect(pipelinePhaseForTask(graph.tasks.find(task => task.id === 'T6')!)).toBe('VALIDATE');
  });

  it('invalidates running implementation when a new constraint arrives', () => {
    const graph = createInitialTaskGraph('Fix auth');
    graph.tasks[1].status = 'RUNNING';
    const updated = applyConstraint(graph, 'Do not change public interface');
    expect(updated.constraints).toContain('Do not change public interface');
    expect(updated.tasks[1].status).toBe('INVALIDATED');
    expect(updated.tasks.filter(task => task.type === 'implementation' && task.status === 'INVALIDATED').map(task => task.id)).toEqual(['T2', 'T3', 'T4']);
  });

  it('does not invalidate review, verification, or completed implementation', () => {
    const graph = createInitialTaskGraph('Fix auth');
    graph.tasks.find(task => task.id === 'T2')!.status = 'COMPLETED';
    graph.tasks.find(task => task.id === 'T5')!.status = 'PENDING';
    const updated = applyConstraint(graph, 'Stay backwards-compatible');
    expect(updated.tasks.find(task => task.id === 'T2')?.status).toBe('COMPLETED');
    expect(updated.tasks.find(task => task.id === 'T5')?.status).toBe('PENDING');
    expect(updated.tasks.find(task => task.id === 'T6')?.status).toBe('PENDING');
  });
});
