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

  it('adds formatted code context when provided', () => {
    const graph = createInitialTaskGraph('Fix auth');
    const packet = compileContextPacket({
      graph,
      task: graph.tasks[0],
      permissionPolicy: 'STANDARD',
      memories: [],
      codeContext: {
        relevantSymbols: ['src/auth.ts:1 login(function): export function login()'],
        relevantFiles: ['src/auth.ts'],
      },
    });

    expect(packet.codeContext).toEqual([
      'Relevant symbols: src/auth.ts:1 login(function): export function login()',
      'Relevant files: src/auth.ts',
    ]);
  });

  it('keeps the no-code-context packet byte-identical to the prior shape', () => {
    const graph = createInitialTaskGraph('Fix auth');
    const packet = compileContextPacket({
      graph,
      task: graph.tasks[0],
      permissionPolicy: 'STANDARD',
      memories: [],
    });

    expect(JSON.stringify(packet)).toBe(JSON.stringify({
      task: {
        id: 'T1',
        objective: 'Plan independent workstreams for: Fix auth',
        type: 'analysis',
        requiredCapabilities: ['read_project'],
      },
      sharedSummary: 'Fix auth',
      userConstraints: [],
      relevantMemory: [],
      upstreamResults: [],
      acceptanceCriteria: ['changes compile', 'tests pass', 'user constraints are preserved'],
      permissionPolicy: 'STANDARD',
      expectedOutput: 'Findings with evidence and uncertainty.',
    }));
  });
});
