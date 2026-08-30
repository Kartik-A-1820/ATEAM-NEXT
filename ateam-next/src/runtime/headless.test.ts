import {describe, expect, it} from 'vitest';
import {runHeadlessProviders, runHeadlessSimulation} from './headless.js';
import type {AteamEvent, ExecutableProviderAdapter} from '../domain/events.js';

describe('headless simulation', () => {
  it('returns final state and canonical events', async () => {
    const result = await runHeadlessSimulation('Refactor auth', 'FAST');
    expect(result.status).toBe('completed');
    expect(result.events.some(event => event.type === 'AgentStreamDelta')).toBe(true);
    expect(Object.keys(result.finalState.tasks).length).toBeGreaterThan(0);
  });

  it('normalizes rate-limited providers without failing all work', async () => {
    const result = await runHeadlessSimulation('Stress providers', 'RATE_LIMIT');
    expect(result.events.some(event => event.type === 'RateLimited')).toBe(true);
    expect(result.status).toBe('completed');
  });

  it('runs provider-backed headless execution through the runtime', async () => {
    const result = await runHeadlessProviders('Use real orchestration shape', undefined, {
      codex: fakeProvider('codex'),
      claude: fakeProvider('claude'),
      agy: fakeProvider('agy'),
      grok: fakeProvider('grok'),
    });

    expect(result.events.some(event => event.type === 'TaskAssigned')).toBe(true);
    expect(result.events.some(event => event.type === 'AgentStreamDelta' && event.agentId === 'codex')).toBe(true);
    expect(result.status).toBe('completed');
  });

  it('FAST scenario fans out to all four agents', async () => {
    const result = await runHeadlessSimulation('Fast parallel run', 'FAST');
    const created = result.events.filter(event => event.type === 'TaskCreated').map(event => event.assignedAgent);
    expect(created).toEqual(expect.arrayContaining(['codex', 'claude', 'agy', 'grok']));
    expect(result.finalState.agents.codex.availability).toBe('READY');
    expect(result.finalState.agents.grok.availability).toBe('READY');
  });

  it('AUTH_FAILURE completes in degraded mode', async () => {
    const result = await runHeadlessSimulation('Auth failure test', 'AUTH_FAILURE');
    expect(result.status).toBe('completed');
    expect(result.events.some(event => event.type === 'AgentAvailabilityChanged' && event.agentId === 'agy' && event.availability === 'AUTH_ERROR')).toBe(true);
  });
});

function fakeProvider(id: 'codex' | 'claude' | 'agy' | 'grok'): ExecutableProviderAdapter {
  return {
    id,
    async probe() {
      return {availability: 'READY' as const};
    },
    async startSession() {
      return undefined;
    },
    async send() {
      return undefined;
    },
    async runOnce(): Promise<AteamEvent[]> {
      return [{type: 'AgentStreamDelta', agentId: id, delta: `${id} done`, at: 1}];
    },
    async runStreaming(_message, onEvent) {
      onEvent({type: 'AgentStreamDelta', agentId: id, delta: `${id} done`, at: 1});
    },
    async cancel() {
      return undefined;
    },
    async shutdown() {
      return undefined;
    },
  };
}
