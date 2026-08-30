import {describe, expect, it, vi} from 'vitest';
import {RuntimeController} from './runtime.js';
import type {AteamEvent, ExecutableProviderAdapter} from '../domain/events.js';
import {PERSISTENT_FAILURE_THRESHOLD} from '../domain/agentHealth.js';

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

  it('executes real-mode tasks through configured providers', async () => {
    const events: AteamEvent[] = [];
    const provider = fakeProvider('codex', async () => [
      {type: 'AgentStreamDelta', agentId: 'codex', delta: 'done', at: 1},
    ]);
    const runtime = new RuntimeController(event => events.push(event), false, 'FAST', {codex: provider});

    runtime.handle({kind: 'submitUserMessage', message: 'Real provider task'});
    await vi.waitFor(() => expect(events.some(event => event.type === 'TaskStatusChanged' && event.status === 'COMPLETED')).toBe(true));

    expect(events.some(event => event.type === 'AgentStreamDelta' && event.taskId?.startsWith('P-'))).toBe(true);
  });

  it('dispatches real-mode tasks even before the knowledge graph finishes indexing', async () => {
    const events: AteamEvent[] = [];
    const prompts: string[] = [];
    const provider = fakeProvider('codex', async message => {
      prompts.push(message);
      return [{type: 'AgentStreamDelta', agentId: 'codex', delta: 'done', at: 1}];
    });
    const runtime = new RuntimeController(event => events.push(event), false, 'FAST', {codex: provider});

    runtime.handle({kind: 'submitUserMessage', message: 'Real provider task'});
    await runtime.waitForIdle();

    expect(prompts.length).toBeGreaterThan(0);
    expect(events.some(event => event.type === 'TaskStatusChanged' && event.status === 'COMPLETED')).toBe(true);
  });

  it('executes real-mode tasks in dependency waves, not all at once', async () => {
    const events: AteamEvent[] = [];
    const runningAt = new Map<string, number>();
    let clock = 0;
    const provider = fakeProvider('codex', async message => {
      const started = ++clock;
      const id = /Task (T\d+)/.exec(message)?.[1] ?? `unknown-${started}`;
      runningAt.set(id, started);
      await Promise.resolve();
      return [{type: 'AgentStreamDelta', agentId: 'codex', delta: `${id} done`, at: started}];
    });
    const runtime = new RuntimeController(event => {
      events.push(event);
      if (event.type === 'TaskStatusChanged' && event.status === 'RUNNING') {
        runningAt.set(event.taskId, clock);
      }
    }, false, 'FAST', {codex: provider});

    runtime.handle({kind: 'submitUserMessage', message: 'Wave execution'});
    await runtime.waitForIdle();

    const completed = events.filter(event => event.type === 'TaskStatusChanged' && event.status === 'COMPLETED');
    expect(completed.length).toBeGreaterThan(0);
    const t1Done = events.findIndex(event => event.type === 'TaskStatusChanged' && event.taskId === 'P-T1' && event.status === 'COMPLETED');
    const t2Run = events.findIndex(event => event.type === 'TaskStatusChanged' && event.taskId === 'P-T2' && event.status === 'RUNNING');
    expect(t1Done).toBeGreaterThanOrEqual(0);
    expect(t2Run).toBeGreaterThan(t1Done);
    expect(events.some(event => event.type === 'PipelinePhaseChanged' && event.phase === 'PLAN')).toBe(true);
    expect(events.some(event => event.type === 'PipelinePhaseChanged' && event.phase === 'DISTRIBUTE')).toBe(true);
    expect(events.some(event => event.type === 'PipelinePhaseChanged' && event.phase === 'IDLE')).toBe(true);
  });

  it('emits status, usage, memory, and clear slash-command output', () => {
    const events: AteamEvent[] = [];
    const runtime = new RuntimeController(event => events.push(event), true, 'FAST');

    runtime.handle({kind: 'slashCommand', name: 'status', args: []});
    runtime.handle({kind: 'slashCommand', name: 'usage', args: []});
    runtime.handle({kind: 'slashCommand', name: 'memory', args: []});
    runtime.handle({kind: 'slashCommand', name: 'clear', args: []});

    expect(events.some(event => event.type === 'PlanUpdated' && event.summary.includes('Ateam status'))).toBe(true);
    expect(events.some(event => event.type === 'PlanUpdated' && event.summary.includes('does not invent remaining-quota'))).toBe(true);
    expect(events.some(event => event.type === 'PlanUpdated' && event.summary.includes('Memory is empty'))).toBe(true);
    expect(events.some(event => event.type === 'ConversationCleared')).toBe(true);
    expect(events.filter(event => event.type === 'RuntimeError')).toHaveLength(0);
  });

  it('reports graph status before indexing', () => {
    const events: AteamEvent[] = [];
    const runtime = new RuntimeController(event => events.push(event), true, 'FAST');

    runtime.handle({kind: 'slashCommand', name: 'graph', args: []});

    expect(events.some(event => event.type === 'PlanUpdated' && event.summary.includes('not indexed yet'))).toBe(true);
  });

  it('reindexes the knowledge graph from a slash command', async () => {
    const events: AteamEvent[] = [];
    const runtime = new RuntimeController(event => events.push(event), true, 'FAST');

    runtime.handle({kind: 'slashCommand', name: 'reindex', args: []});
    await vi.waitFor(() => expect(events.some(event => event.type === 'KnowledgeGraphIndexed')).toBe(true));

    const indexed = events.find(event => event.type === 'KnowledgeGraphIndexed');
    expect(indexed?.type === 'KnowledgeGraphIndexed' ? indexed.fileCount : 0).toBeGreaterThan(0);
    expect(events.some(event => event.type === 'PlanUpdated' && event.summary.includes('Knowledge graph reindexed'))).toBe(true);
  });

  it('replies to small talk without launching the plan pipeline (simulate mode)', () => {
    const events: AteamEvent[] = [];
    const runtime = new RuntimeController(event => events.push(event), true, 'FAST');

    runtime.handle({kind: 'submitUserMessage', message: 'Hi'});

    expect(events.some(event => event.type === 'AteamReplied')).toBe(true);
    expect(events.some(event => event.type === 'TaskCreated')).toBe(false);
    expect(events.some(event => event.type === 'PipelinePhaseChanged')).toBe(false);
  });

  it('replies to small talk via a configured provider instead of planning (real mode)', async () => {
    const events: AteamEvent[] = [];
    const codex = fakeProvider('codex', async () => [{type: 'AgentStreamDelta', agentId: 'codex', delta: 'Hey there!', at: Date.now()}]);
    const runtime = new RuntimeController(event => events.push(event), false, 'FAST', {codex});

    runtime.handle({kind: 'submitUserMessage', message: 'Hello'});
    await vi.waitFor(() => expect(events.some(event => event.type === 'AteamReplied')).toBe(true));

    expect(events.find(event => event.type === 'AteamReplied')).toMatchObject({text: 'Hey there!'});
    expect(events.some(event => event.type === 'TaskCreated')).toBe(false);
  });

  it('replies to small talk gracefully with zero configured providers', () => {
    const events: AteamEvent[] = [];
    const runtime = new RuntimeController(event => events.push(event), false, 'FAST', {});

    runtime.handle({kind: 'submitUserMessage', message: 'thanks'});

    expect(events.some(event => event.type === 'AteamReplied')).toBe(true);
    expect(events.some(event => event.type === 'RuntimeError')).toBe(false);
  });

  it('does not let small talk disturb an already-active plan', async () => {
    const events: AteamEvent[] = [];
    const codex = fakeProvider('codex', async () => new Promise(() => {}));
    const runtime = new RuntimeController(event => events.push(event), false, 'FAST', {codex});

    runtime.handle({kind: 'submitUserMessage', message: 'Fix auth'});
    await vi.waitFor(() => expect(events.some(event => event.type === 'TaskStatusChanged' && event.status === 'RUNNING')).toBe(true));
    events.length = 0;

    runtime.handle({kind: 'submitUserMessage', message: 'thanks'});

    expect(events.some(event => event.type === 'AteamReplied')).toBe(true);
    expect(events.some(event => event.type === 'TaskInvalidated')).toBe(false);
    expect(events.some(event => event.type === 'ContextUpdated')).toBe(false);
  });

  it('reassigns a task to another agent after a rate limit instead of failing it', async () => {
    const events: AteamEvent[] = [];
    let codexCalls = 0;
    const codex = fakeProvider('codex', async () => {
      codexCalls += 1;
      return [{type: 'RateLimited', agentId: 'codex', resetHint: '1s', at: Date.now()}];
    });
    const claude = fakeProvider('claude', async () => [{type: 'AgentStreamDelta', agentId: 'claude', delta: 'done', at: Date.now()}]);
    const runtime = new RuntimeController(event => events.push(event), false, 'FAST', {codex, claude});

    runtime.handle({kind: 'submitUserMessage', message: 'Fix auth'});
    await runtime.waitForIdle();

    expect(codexCalls).toBeGreaterThan(0);
    expect(events.some(event => event.type === 'TaskReassigned' && event.fromAgent === 'codex' && event.toAgent === 'claude')).toBe(true);
    expect(events.some(event => event.type === 'AgentCooldownChanged' && event.agentId === 'codex' && event.cooldownUntil !== undefined)).toBe(true);
    const completed = events.filter(event => event.type === 'TaskStatusChanged' && event.status === 'COMPLETED');
    expect(completed.length).toBeGreaterThan(0);
    expect(events.some(event => event.type === 'TaskStatusChanged' && event.status === 'FAILED')).toBe(false);
  });

  it('does not force a rate-limited agent back to READY', async () => {
    const events: AteamEvent[] = [];
    const codex = fakeProvider('codex', async () => [{type: 'RateLimited', agentId: 'codex', resetHint: '10m', at: Date.now()}]);
    const claude = fakeProvider('claude', async () => [{type: 'AgentStreamDelta', agentId: 'claude', delta: 'done', at: Date.now()}]);
    const runtime = new RuntimeController(event => events.push(event), false, 'FAST', {codex, claude});

    runtime.handle({kind: 'submitUserMessage', message: 'Fix auth'});
    await runtime.waitForIdle();

    const codexAvailability = events.filter(event => event.type === 'AgentAvailabilityChanged' && event.agentId === 'codex');
    expect(codexAvailability.some(event => event.type === 'AgentAvailabilityChanged' && event.availability === 'READY')).toBe(false);
  });

  it('blocks a task and recovers automatically once its sole agent comes off cooldown', async () => {
    vi.useFakeTimers();
    const events: AteamEvent[] = [];
    let calls = 0;
    const codex = fakeProvider('codex', async () => {
      calls += 1;
      if (calls === 1) return [{type: 'RateLimited', agentId: 'codex', resetHint: '2s', at: Date.now()}];
      return [{type: 'AgentStreamDelta', agentId: 'codex', delta: 'done', at: Date.now()}];
    });
    const runtime = new RuntimeController(event => events.push(event), false, 'FAST', {codex});

    runtime.handle({kind: 'submitUserMessage', message: 'Fix auth'});
    await vi.advanceTimersByTimeAsync(500);
    expect(events.some(event => event.type === 'TaskStatusChanged' && event.status === 'BLOCKED')).toBe(true);
    expect(events.some(event => event.type === 'TaskStatusChanged' && event.status === 'COMPLETED')).toBe(false);

    await vi.advanceTimersByTimeAsync(3000);
    await runtime.waitForIdle();

    expect(calls).toBeGreaterThan(1);
    expect(events.some(event => event.type === 'TaskStatusChanged' && event.status === 'COMPLETED')).toBe(true);
    vi.useRealTimers();
  });

  it('keeps planned implement assignments instead of collapsing onto Codex', async () => {
    const events: AteamEvent[] = [];
    const runtime = new RuntimeController(event => events.push(event), false, 'FAST', {
      grok: fakeProvider('grok', async () => [{type: 'AgentStreamDelta', agentId: 'grok', delta: 'plan', at: 1}]),
      codex: fakeProvider('codex', async () => [{type: 'AgentStreamDelta', agentId: 'codex', delta: 'impl', at: 1}]),
      claude: fakeProvider('claude', async () => [{type: 'AgentStreamDelta', agentId: 'claude', delta: 'review', at: 1}]),
      agy: fakeProvider('agy', async () => [{type: 'AgentStreamDelta', agentId: 'agy', delta: 'verify', at: 1}]),
    });

    runtime.handle({kind: 'submitUserMessage', message: 'Fix auth'});
    await runtime.waitForIdle();

    expect(events.some(event => event.type === 'TaskReassigned' && event.toAgent === 'codex')).toBe(false);
    const t3 = events.find(event => event.type === 'TaskAssigned' && event.taskId === 'P-T3');
    expect(t3?.type === 'TaskAssigned' ? t3.agentId : undefined).not.toBe('codex');
  });

  it('treats usage-limit RuntimeError as a cooldown instead of a terminal failure', async () => {
    const events: AteamEvent[] = [];
    const runtime = new RuntimeController(event => events.push(event), false, 'FAST', {
      grok: fakeProvider('grok', async () => [{type: 'AgentStreamDelta', agentId: 'grok', delta: 'plan', at: 1}]),
      codex: fakeProvider('codex', async () => [{type: 'RuntimeError', message: "You've hit your usage limit. try again at 5:52 PM.", at: 1}]),
      claude: fakeProvider('claude', async () => [{type: 'AgentStreamDelta', agentId: 'claude', delta: 'recovered', at: 1}]),
      agy: fakeProvider('agy', async () => [{type: 'AgentStreamDelta', agentId: 'agy', delta: 'ok', at: 1}]),
    });

    runtime.handle({kind: 'submitUserMessage', message: 'Fix auth'});
    await runtime.waitForIdle();

    expect(events.some(event => event.type === 'RateLimited' && event.agentId === 'codex')).toBe(true);
    expect(events.some(event => event.type === 'AgentCooldownChanged' && event.agentId === 'codex')).toBe(true);
    expect(events.some(event => event.type === 'TaskReassigned' && event.fromAgent === 'codex')).toBe(true);
  });

  it('cancels remaining waves when analysis says stop after T1', async () => {
    const events: AteamEvent[] = [];
    const impl = vi.fn(async (): Promise<AteamEvent[]> => [{type: 'AgentStreamDelta', agentId: 'codex', delta: 'should not run', at: 1}]);
    const runtime = new RuntimeController(event => events.push(event), false, 'FAST', {
      grok: fakeProvider('grok', async () => [{type: 'AgentStreamDelta', agentId: 'grok', delta: 'Recommended pipeline: stop after T1. Do not spawn.', at: 1}]),
      codex: fakeProvider('codex', impl),
    });

    runtime.handle({kind: 'submitUserMessage', message: 'Fix auth'});
    await runtime.waitForIdle();

    expect(impl).not.toHaveBeenCalled();
    expect(events.some(event => event.type === 'TaskStatusChanged' && event.taskId === 'P-T2' && event.status === 'CANCELLED')).toBe(true);
  });

  it('re-verifies an AUTH-cooled-down agent with probe() before wasting a real task on it', async () => {
    vi.useFakeTimers();
    const events: AteamEvent[] = [];
    let runOnceCalls = 0;
    let probeCalls = 0;
    const codex: ExecutableProviderAdapter = {
      id: 'codex',
      async probe() {
        probeCalls += 1;
        return {availability: 'AUTH_ERROR', reason: 'still not signed in'};
      },
      async startSession() { return undefined; },
      async send() { return undefined; },
      async runOnce() {
        return [];
      },
      async runStreaming(_message, onEvent) {
        runOnceCalls += 1;
        onEvent({type: 'AgentAvailabilityChanged', agentId: 'codex', availability: 'AUTH_ERROR', reason: 'not signed in', at: Date.now()});
      },
      async cancel() { return undefined; },
      async shutdown() { return undefined; },
    };
    // Single provider on purpose: forces the dispatch loop to keep reconsidering
    // codex (there's no alternative), which is what exercises the recheck path.
    const runtime = new RuntimeController(event => events.push(event), false, 'FAST', {codex});

    runtime.handle({kind: 'submitUserMessage', message: 'Fix auth'});
    await vi.advanceTimersByTimeAsync(1000);
    expect(runOnceCalls).toBe(1);

    // Past the fixed AUTH recheck window: codex becomes a candidate again.
    await vi.advanceTimersByTimeAsync(11 * 60_000);

    expect(probeCalls).toBeGreaterThan(0);
    // The probe still reports AUTH_ERROR, so the real task attempt must not
    // be wasted a second time — only runOnce's call count proves that.
    expect(runOnceCalls).toBe(1);
    expect(events.some(event => event.type === 'AgentCooldownChanged' && event.agentId === 'codex' && event.reason.includes('re-authenticate'))).toBe(true);

    runtime.handle({kind: 'stop', scope: 'all'});
    vi.useRealTimers();
  });

  it('lets a previously AUTH-blocked agent back in once probe() confirms it is fixed', async () => {
    vi.useFakeTimers();
    const events: AteamEvent[] = [];
    let authed = false;
    let runOnceCalls = 0;
    const codex: ExecutableProviderAdapter = {
      id: 'codex',
      async probe() {
        return authed ? {availability: 'READY'} : {availability: 'AUTH_ERROR', reason: 'not signed in'};
      },
      async startSession() { return undefined; },
      async send() { return undefined; },
      async runOnce() {
        return [];
      },
      async runStreaming(_message, onEvent) {
        runOnceCalls += 1;
        if (!authed) {
          authed = true;
          onEvent({type: 'AgentAvailabilityChanged', agentId: 'codex', availability: 'AUTH_ERROR', reason: 'not signed in', at: Date.now()});
          return;
        }
        onEvent({type: 'AgentStreamDelta', agentId: 'codex', delta: 'done', at: Date.now()});
      },
      async cancel() { return undefined; },
      async shutdown() { return undefined; },
    };
    const runtime = new RuntimeController(event => events.push(event), false, 'FAST', {codex});

    runtime.handle({kind: 'submitUserMessage', message: 'Fix auth'});
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    await runtime.waitForIdle();

    expect(runOnceCalls).toBeGreaterThan(1);
    expect(events.some(event => event.type === 'TaskStatusChanged' && event.status === 'COMPLETED')).toBe(true);
    vi.useRealTimers();
  });

  it('explains exactly why a task failed when no agent can ever run it', async () => {
    const events: AteamEvent[] = [];
    const runtime = new RuntimeController(event => events.push(event), false, 'FAST', {codex: undefined, claude: undefined});

    runtime.handle({kind: 'submitUserMessage', message: 'Fix auth'});
    await runtime.waitForIdle();

    expect(events.some(event => event.type === 'RuntimeError' && event.message.includes('No agent available') && event.message.includes('/doctor'))).toBe(true);
    expect(events.some(event => event.type === 'TaskStatusChanged' && event.status === 'FAILED')).toBe(true);
  });

  it('prefixes a crash message with which agent and task failed', async () => {
    const events: AteamEvent[] = [];
    const codex = fakeProvider('codex', async () => { throw new Error('spawn ENOENT'); });
    const claude = fakeProvider('claude', async () => [{type: 'AgentStreamDelta', agentId: 'claude', delta: 'done', at: Date.now()}]);
    const runtime = new RuntimeController(event => events.push(event), false, 'FAST', {codex, claude});

    runtime.handle({kind: 'submitUserMessage', message: 'Fix auth'});
    await runtime.waitForIdle();

    const crash = events.find(event => event.type === 'RuntimeError' && event.message.includes('spawn ENOENT'));
    expect(crash?.type === 'RuntimeError' ? crash.message : undefined).toMatch(/^codex crashed while running P-T\d+: spawn ENOENT/);
  });

  it('escalates the cooldown message after repeated consecutive failures', async () => {
    vi.useFakeTimers();
    const events: AteamEvent[] = [];
    const crashy = fakeProvider('codex', async () => { throw new Error('down'); });
    const runtime = new RuntimeController(event => events.push(event), false, 'FAST', {codex: crashy});

    runtime.handle({kind: 'submitUserMessage', message: 'Fix auth'});
    await vi.advanceTimersByTimeAsync(1000);
    // Same lone agent, so it keeps getting reconsidered after each cooldown
    // window (60s, 5m, ...) and keeps crashing — enough cycles to cross the
    // persistent-failure threshold.
    for (let i = 1; i < PERSISTENT_FAILURE_THRESHOLD; i++) {
      await vi.advanceTimersByTimeAsync(20 * 60_000);
    }

    expect(events.some(event => event.type === 'AgentCooldownChanged' && event.reason.includes('check /doctor'))).toBe(true);

    runtime.handle({kind: 'stop', scope: 'all'});
    vi.useRealTimers();
  });

  it('cancels real-mode providers on stop', async () => {
    const events: AteamEvent[] = [];
    const cancel = vi.fn();
    const provider = fakeProvider('codex', async () => [], cancel);
    const runtime = new RuntimeController(event => events.push(event), false, 'FAST', {codex: provider});

    runtime.handle({kind: 'submitUserMessage', message: 'Real provider task'});
    runtime.handle({kind: 'stop', scope: 'all'});

    await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith('all'));
  });
});

function fakeProvider(
  id: 'codex' | 'claude' | 'agy' | 'grok',
  runOnce: (message: string) => Promise<AteamEvent[]>,
  cancel: (scope?: string) => void | Promise<void> = () => undefined,
): ExecutableProviderAdapter {
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
    runOnce,
    async runStreaming(message, onEvent) {
      for (const event of await runOnce(message)) onEvent(event);
    },
    async cancel(scope?: string) {
      await cancel(scope);
    },
    async shutdown() {
      return undefined;
    },
  };
}
