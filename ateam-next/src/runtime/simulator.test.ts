import {describe, expect, it, vi} from 'vitest';
import {classifyMessage, Simulator} from './simulator.js';
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

  it('fans out tasks to all four agents and restores READY on cancel', async () => {
    vi.useFakeTimers();
    const events: AteamEvent[] = [];
    const simulator = new Simulator(event => events.push(event));
    simulator.run('Parallel workstream', 'STREAMING');
    await vi.runAllTimersAsync();
    const created = events.filter(event => event.type === 'TaskCreated').map(event => event.assignedAgent);
    expect(created).toEqual(expect.arrayContaining(['codex', 'claude', 'agy', 'grok']));

    const slow: AteamEvent[] = [];
    const cancellable = new Simulator(event => slow.push(event));
    cancellable.run('Slow work', 'SLOW');
    await vi.advanceTimersByTimeAsync(500);
    cancellable.cancel();
    expect(slow.some(event => event.type === 'AgentAvailabilityChanged' && event.availability === 'READY' && event.agentId === 'codex')).toBe(true);
    vi.useRealTimers();
  });

  it('emits tool events and isolated auth failures', async () => {
    vi.useFakeTimers();
    const events: AteamEvent[] = [];
    const simulator = new Simulator(event => events.push(event));
    simulator.run('Heavy tool task', 'TOOL_HEAVY');
    await vi.runAllTimersAsync();
    expect(events.some(event => event.type === 'ToolStarted')).toBe(true);
    expect(events.some(event => event.type === 'ToolFinished')).toBe(true);

    const auth: AteamEvent[] = [];
    const failing = new Simulator(event => auth.push(event));
    failing.run('Test auth scenario', 'AUTH_FAILURE');
    await vi.runAllTimersAsync();
    expect(auth.some(event => event.type === 'AgentAvailabilityChanged' && event.agentId === 'agy' && event.availability === 'AUTH_ERROR')).toBe(true);
    vi.useRealTimers();
  });
});

describe('classifyMessage', () => {
  it('recognizes short greetings as conversation, not a task', () => {
    expect(classifyMessage('Hi')).toBe('CONVERSATION');
    expect(classifyMessage('hello')).toBe('CONVERSATION');
    expect(classifyMessage('thanks!')).toBe('CONVERSATION');
    expect(classifyMessage('  Hey  ')).toBe('CONVERSATION');
  });

  it('does not misclassify a real request that happens to start with a greeting word', () => {
    expect(classifyMessage('Hi, please refactor the auth module and add tests')).not.toBe('CONVERSATION');
  });

  it('still routes real objectives and steering as before', () => {
    expect(classifyMessage('Refactor auth')).toBe('ADDITIONAL_TASK');
    expect(classifyMessage('Do not change the public API')).toBe('NEW_CONSTRAINT');
    expect(classifyMessage('cancel that work')).toBe('CANCEL_REQUEST');
    expect(classifyMessage('should we prioritize the auth fix?')).toBe('QUESTION');
  });
});
