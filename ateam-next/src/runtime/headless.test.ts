import {describe, expect, it} from 'vitest';
import {runHeadlessSimulation} from './headless.js';

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
});
