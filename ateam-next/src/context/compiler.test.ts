import {describe, expect, it} from 'vitest';
import {compileContextPacket} from './compiler.js';
import {createInitialTaskGraph} from '../planner/taskGraph.js';

describe('compileContextPacket', () => {
  it('builds task-scoped context without rejected memories', () => {
    const graph = createInitialTaskGraph('Fix auth', ['Do not change public API']);
    const packet = compileContextPacket({
      graph,
      task: graph.tasks[0],
      permissionPolicy: 'STANDARD',
      memories: [
        {id: 'M1', category: 'USER_CONSTRAINT', content: 'Do not change public API', verification: 'VERIFIED', evidence: ['user'], createdAt: 1},
        {id: 'M2', category: 'HYPOTHESIS', content: 'Unsupported guess', verification: 'REJECTED', evidence: [], createdAt: 2},
      ],
    });

    expect(packet.userConstraints).toEqual(['Do not change public API']);
    expect(packet.relevantMemory.map(memory => memory.id)).toEqual(['M1']);
    expect(packet.expectedOutput).toContain('Findings');
  });
});
