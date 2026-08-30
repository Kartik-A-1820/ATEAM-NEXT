import {describe, expect, it, vi} from 'vitest';
import {Simulator} from './simulator.js';
import type {AteamEvent} from '../domain/events.js';

describe('Simulator', () => {
  it('emits canonical events for a streamed run', async () => {
    vi.useFakeTimers();
    const events: AteamEvent[] = [];
    const simulator = new Simulator(event => events.push(event));

    simulator.run('Refactor auth');
    await vi.runAllTimersAsync();

    expect(events.some(event => event.type === 'UserMessageClassified')).toBe(true);
    expect(events.some(event => event.type === 'TaskCreated')).toBe(true);
    expect(events.some(event => event.type === 'AgentStreamDelta')).toBe(true);
    expect(events.some(event => event.type === 'TaskStatusChanged' && event.status === 'COMPLETED')).toBe(true);
    vi.useRealTimers();
  });

  it('emits rate limit without failing the whole runtime', async () => {
    vi.useFakeTimers();
    const events: AteamEvent[] = [];
    const simulator = new Simulator(event => events.push(event));

    simulator.run('Stress providers', 'RATE_LIMIT');
    await vi.runAllTimersAsync();

    expect(events.some(event => event.type === 'RateLimited' && event.agentId === 'grok')).toBe(true);
    expect(events.some(event => event.type === 'TaskCreated')).toBe(true);
    vi.useRealTimers();
  });

  it('marks active simulated tasks cancelled', async () => {
    vi.useFakeTimers();
    const events: AteamEvent[] = [];
    const simulator = new Simulator(event => events.push(event));

    simulator.run('Long task', 'SLOW');
    await vi.advanceTimersByTimeAsync(130);
    simulator.cancel();

    expect(events.some(event => event.type === 'TaskStatusChanged' && event.status === 'CANCELLED')).toBe(true);
    vi.useRealTimers();
  });
});
