import {describe, expect, it} from 'vitest';
import {createAgentHealth, isOnCooldown, parseResetHint, recordRunOutcome, recordSuccess, recordTransientFailure, reduceHealthEvents} from './agentHealth.js';
import type {AteamEvent} from './events.js';

describe('agentHealth', () => {
  it('is not on cooldown initially', () => {
    const health = createAgentHealth('codex');
    expect(isOnCooldown(health)).toBe(false);
  });

  it('enters cooldown on transient failure and clears it on success', () => {
    const now = 1_000_000;
    let health = createAgentHealth('codex');
    health = recordTransientFailure(health, {reason: 'rate limited'}, now);
    expect(isOnCooldown(health, now)).toBe(true);
    expect(health.consecutiveFailures).toBe(1);

    health = recordSuccess(health);
    expect(isOnCooldown(health, now)).toBe(false);
    expect(health.consecutiveFailures).toBe(0);
  });

  it('escalates backoff with consecutive failures', () => {
    const now = 1_000_000;
    let health = createAgentHealth('grok');
    health = recordTransientFailure(health, {reason: 'a'}, now);
    const firstCooldown = health.cooldownUntil!;
    health = recordTransientFailure(health, {reason: 'b'}, now);
    const secondCooldown = health.cooldownUntil!;
    expect(secondCooldown - now).toBeGreaterThan(firstCooldown - now);
  });

  it('prefers an explicit resetAtMs over the backoff schedule', () => {
    const now = 1_000_000;
    const health = recordTransientFailure(createAgentHealth('claude'), {reason: 'rate limited', resetAtMs: now + 42}, now);
    expect(health.cooldownUntil).toBe(now + 42);
  });

  it('parses relative reset hints', () => {
    const now = 1_000_000;
    expect(parseResetHint('60s', now)).toBe(now + 60_000);
    expect(parseResetHint('5m', now)).toBe(now + 5 * 60_000);
    expect(parseResetHint('1h', now)).toBe(now + 3_600_000);
  });

  it('returns undefined for unparseable or past reset hints', () => {
    const now = 1_000_000;
    expect(parseResetHint(undefined, now)).toBeUndefined();
    expect(parseResetHint('soon', now)).toBeUndefined();
    expect(parseResetHint(new Date(now - 1000).toISOString(), now)).toBeUndefined();
  });

  it('parses clock reset hints such as try again at 5:52 PM', () => {
    const now = new Date(2026, 7, 30, 12, 0, 0).getTime();
    const reset = parseResetHint('try again at 5:52 PM', now);
    expect(reset).toBe(new Date(2026, 7, 30, 17, 52, 0).getTime());
  });

  it('gives an AUTH failure a fixed recheck window instead of escalating backoff', () => {
    const now = 1_000_000;
    let health = createAgentHealth('codex');
    health = recordTransientFailure(health, {reason: 'needs login', kind: 'AUTH'}, now);
    const first = health.cooldownUntil!;
    health = recordTransientFailure(health, {reason: 'still needs login', kind: 'AUTH'}, now);
    const second = health.cooldownUntil!;
    expect(health.cooldownKind).toBe('AUTH');
    // Unlike RATE_LIMIT/UNHEALTHY, waiting longer never fixes an auth problem,
    // so repeated AUTH failures must not escalate the wait — only a fresh
    // probe() (done by the caller) should be able to clear it.
    expect(second - now).toBe(first - now);
  });

  it('still escalates backoff for UNHEALTHY (unknown-cause) failures', () => {
    const now = 1_000_000;
    let health = createAgentHealth('agy');
    health = recordTransientFailure(health, {reason: 'crash', kind: 'UNHEALTHY'}, now);
    const first = health.cooldownUntil!;
    health = recordTransientFailure(health, {reason: 'crash again', kind: 'UNHEALTHY'}, now);
    const second = health.cooldownUntil!;
    expect(second - now).toBeGreaterThan(first - now);
  });
});

describe('reduceHealthEvents', () => {
  const now = 1_000_000;

  it('puts an agent on RATE_LIMIT cooldown from a RateLimited event', () => {
    const health = reduceHealthEvents([
      {type: 'RateLimited', agentId: 'codex', resetHint: '60s', at: now},
    ]);
    expect(health.codex).toMatchObject({
      id: 'codex',
      consecutiveFailures: 1,
      cooldownUntil: now + 60_000,
      cooldownKind: 'RATE_LIMIT',
    });
    expect(isOnCooldown(health.codex, now)).toBe(true);
  });

  it('puts an agent on AUTH cooldown from AUTH_ERROR and clears it on READY', () => {
    const events: AteamEvent[] = [
      {type: 'AgentAvailabilityChanged', agentId: 'grok', availability: 'AUTH_ERROR', reason: 'not authenticated', at: now},
      {type: 'AgentAvailabilityChanged', agentId: 'grok', availability: 'READY', at: now + 1},
    ];
    const afterAuth = reduceHealthEvents(events.slice(0, 1));
    expect(afterAuth.grok).toMatchObject({
      id: 'grok',
      consecutiveFailures: 1,
      cooldownKind: 'AUTH',
      cooldownReason: 'not authenticated',
      cooldownUntil: now + 10 * 60_000,
    });
    expect(isOnCooldown(afterAuth.grok, now)).toBe(true);

    const afterReady = reduceHealthEvents(events);
    expect(afterReady.grok).toMatchObject({
      id: 'grok',
      consecutiveFailures: 0,
      lastSeenAt: now + 1,
    });
    expect(afterReady.grok?.cooldownUntil).toBeUndefined();
    expect(afterReady.grok?.cooldownKind).toBeUndefined();
    expect(isOnCooldown(afterReady.grok, now + 1)).toBe(false);
  });

  it('ignores unrelated event types', () => {
    const health = reduceHealthEvents([
      {type: 'TaskCreated', taskId: 'T1', objective: 'implement', at: now},
    ]);
    expect(health).toEqual({});
  });
});

describe('recordRunOutcome', () => {
  it('tracks real run counts and success rate, never inventing a value before any run', () => {
    let health = createAgentHealth('codex');
    expect(health.totalRuns).toBeUndefined();

    health = recordRunOutcome(health, {success: true, durationMs: 1000});
    expect(health.totalRuns).toBe(1);
    expect(health.totalSuccesses).toBe(1);
    expect(health.rollingLatencyMs).toBe(1000);

    health = recordRunOutcome(health, {success: false, durationMs: 2000});
    expect(health.totalRuns).toBe(2);
    expect(health.totalSuccesses).toBe(1);
    expect(health.rollingLatencyMs).toBe(Math.round(1000 * 0.7 + 2000 * 0.3));
  });
});
