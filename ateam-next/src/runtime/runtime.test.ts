import {describe, expect, it, vi} from 'vitest';
import {RuntimeController} from './runtime.js';
import type {AteamEvent} from '../domain/events.js';

describe('RuntimeController', () => {
  it('routes slash commands to canonical view events', () => {
    const events: AteamEvent[] = [];
    const runtime = new RuntimeController(event => events.push(event), true, 'FAST');

    runtime.handle({kind: 'slashCommand', name: 'agents', args: []});

    expect(events).toContainEqual(expect.objectContaining({type: 'ViewChanged', tab: 'Agents'}));
  });

  it('emits one stop event for cancellation', () => {
    const events: AteamEvent[] = [];
    const runtime = new RuntimeController(event => events.push(event), true, 'SLOW');

    runtime.handle({kind: 'submitUserMessage', message: 'long task'});
    runtime.handle({kind: 'stop', scope: 'all'});

    expect(events.filter(event => event.type === 'StopRequested')).toHaveLength(1);
  });

  it('processes live constraints without spawning a second simulated workstream', async () => {
    vi.useFakeTimers();
    const events: AteamEvent[] = [];
    const runtime = new RuntimeController(event => events.push(event), true, 'SLOW');

    runtime.handle({kind: 'submitUserMessage', message: 'Refactor auth'});
    runtime.handle({kind: 'submitUserMessage', message: 'Do not change the public AuthService interface'});
    await vi.runAllTimersAsync();

    expect(events.some(event => event.type === 'ContextUpdated')).toBe(true);
    expect(events.some(event => event.type === 'MemoryUpdated' && event.category === 'USER_CONSTRAINT')).toBe(true);
    expect(events.some(event => event.type === 'TaskInvalidated' && event.taskId === 'P-T2')).toBe(true);
    expect(events.filter(event => event.type === 'PlanUpdated').length).toBeGreaterThanOrEqual(2);
    expect(events.filter(event => event.type === 'TaskCreated' && !event.taskId.startsWith('P-'))).toHaveLength(4);
    vi.useRealTimers();
  });

  it('treats cancel steering as immediate cancellation', () => {
    const events: AteamEvent[] = [];
    const runtime = new RuntimeController(event => events.push(event), true, 'SLOW');

    runtime.handle({kind: 'submitUserMessage', message: 'Refactor auth'});
    runtime.handle({kind: 'submitUserMessage', message: 'cancel that work'});

    expect(events.some(event => event.type === 'StopRequested' && event.scope === 'current')).toBe(true);
  });
});
