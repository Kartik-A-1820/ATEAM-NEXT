import type {AteamEvent} from './events.js';
import type {AgentId} from './types.js';

/**
 * Why an agent is cooling down, so the runtime can make a different decision
 * per kind instead of treating every failure the same way:
 *  - 'RATE_LIMIT': waiting resolves it. Exponential backoff (or the provider's
 *    own reset hint) is the correct strategy — just retry after the window.
 *  - 'AUTH': waiting does NOT resolve it — it needs the user to re-authenticate.
 *    Blind retries would just fail again identically. Use a fixed recheck
 *    window and verify with a cheap probe() before wasting a real task on it.
 *  - 'UNHEALTHY': a crash/timeout/malformed-output failure of unknown cause.
 *    Treated like a rate limit for backoff purposes (retry after waiting),
 *    but consecutive-failure count drives escalation messaging separately.
 */
export type CooldownKind = 'RATE_LIMIT' | 'AUTH' | 'UNHEALTHY';

export interface AgentHealth {
  id: AgentId;
  consecutiveFailures: number;
  cooldownUntil?: number;
  cooldownReason?: string;
  cooldownKind?: CooldownKind;
  lastSeenAt?: number;
  /** Observed, not invented: real counts/timings from actual dispatches, for /usage. */
  totalRuns?: number;
  totalSuccesses?: number;
  rollingLatencyMs?: number;
}

const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const AUTH_RECHECK_MS = 10 * 60_000;

/** Consecutive failures at or beyond this count are treated as a persistent
 * problem worth calling out explicitly, not just another routine retry. */
export const PERSISTENT_FAILURE_THRESHOLD = 3;

export function createAgentHealth(id: AgentId): AgentHealth {
  return {id, consecutiveFailures: 0};
}

export function isOnCooldown(health: AgentHealth | undefined, now = Date.now()): boolean {
  return health?.cooldownUntil !== undefined && health.cooldownUntil > now;
}

export function recordSuccess(health: AgentHealth): AgentHealth {
  return {...health, consecutiveFailures: 0, cooldownUntil: undefined, cooldownReason: undefined, cooldownKind: undefined, lastSeenAt: Date.now()};
}

export function recordTransientFailure(
  health: AgentHealth,
  options: {reason: string; resetAtMs?: number; kind?: CooldownKind},
  now = Date.now(),
): AgentHealth {
  const consecutiveFailures = health.consecutiveFailures + 1;
  const kind = options.kind ?? 'RATE_LIMIT';
  const cooldownUntil = kind === 'AUTH'
    // Waiting longer never helps an auth problem, so don't escalate the
    // window with repeated failures — just recheck periodically via probe().
    ? options.resetAtMs ?? now + AUTH_RECHECK_MS
    : options.resetAtMs ?? now + jitter(BACKOFF_MS[Math.min(consecutiveFailures - 1, BACKOFF_MS.length - 1)]);
  return {...health, consecutiveFailures, cooldownUntil, cooldownReason: options.reason, cooldownKind: kind, lastSeenAt: now};
}

/** Tracks real observed run outcomes/latency for /usage — separate from the
 * cooldown bookkeeping above, and never invented when no runs have happened yet. */
export function recordRunOutcome(health: AgentHealth, options: {success: boolean; durationMs: number}): AgentHealth {
  const totalRuns = (health.totalRuns ?? 0) + 1;
  const totalSuccesses = (health.totalSuccesses ?? 0) + (options.success ? 1 : 0);
  const rollingLatencyMs = health.rollingLatencyMs === undefined
    ? options.durationMs
    : Math.round(health.rollingLatencyMs * 0.7 + options.durationMs * 0.3);
  return {...health, totalRuns, totalSuccesses, rollingLatencyMs};
}

/**
 * Parses a provider-supplied rate-limit reset hint into an absolute epoch ms.
 * Accepts an ISO/parseable date, or a relative duration like "60s" / "5m" / "1h".
 * Returns undefined when the hint is missing or unparseable, so the caller
 * falls back to the exponential backoff schedule instead.
 */
export function looksLikeUsageLimit(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('usage limit')
    || lower.includes('rate limit')
    || lower.includes('rate-limit')
    || lower.includes('too many requests')
    || /\bquota\b/.test(lower);
}

export function parseResetHint(hint: string | undefined, now = Date.now()): number | undefined {
  if (!hint) return undefined;
  const trimmed = hint.trim();
  const relative = /^(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs)$/i.exec(trimmed);
  if (relative) {
    const value = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const multiplier = unit.startsWith('s') ? 1000 : unit.startsWith('m') ? 60_000 : 3_600_000;
    return now + value * multiplier;
  }
  const clock = /(?:try again at|reset(?:s)? at)?\s*(\d{1,2}):(\d{2})\s*(am|pm)\b/i.exec(trimmed);
  if (clock) {
    let hours = Number(clock[1]) % 12;
    if (clock[3].toLowerCase() === 'pm') hours += 12;
    const next = new Date(now);
    next.setHours(hours, Number(clock[2]), 0, 0);
    if (next.getTime() <= now) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  const absolute = Date.parse(trimmed);
  if (!Number.isNaN(absolute) && absolute > now) return absolute;
  return undefined;
}

function jitter(ms: number): number {
  return Math.round(ms * (0.85 + Math.random() * 0.3));
}

/**
 * Reconstruct per-agent health from a stored event log. Mirrors
 * RuntimeController.applyCooldown / recordAgentSuccess so resume can seed
 * the in-memory health map instead of treating every agent as READY.
 *
 * AgentCooldownChanged is a derived side-effect of those two methods and is
 * skipped here — the RateLimited / AgentAvailabilityChanged events that
 * triggered them are the source of truth.
 */
export function reduceHealthEvents(events: AteamEvent[]): Partial<Record<AgentId, AgentHealth>> {
  const health: Partial<Record<AgentId, AgentHealth>> = {};
  for (const event of events) {
    if (event.type === 'RateLimited') {
      applyReplayedCooldown(health, event.agentId, {
        reason: event.resetHint ? `rate limited (reset ${event.resetHint})` : 'rate limited',
        resetHint: event.resetHint,
        kind: 'RATE_LIMIT',
      }, event.at);
      continue;
    }
    if (event.type !== 'AgentAvailabilityChanged') continue;
    if (event.availability === 'AUTH_ERROR' || event.availability === 'SIGNED_OUT' || event.availability === 'UNHEALTHY') {
      const kind: CooldownKind = event.availability === 'UNHEALTHY' ? 'UNHEALTHY' : 'AUTH';
      applyReplayedCooldown(health, event.agentId, {
        reason: event.reason ?? fallbackAvailabilityReason(event.availability),
        kind,
      }, event.at);
      continue;
    }
    if (event.availability === 'READY') {
      const current = health[event.agentId] ?? createAgentHealth(event.agentId);
      health[event.agentId] = {
        ...current,
        consecutiveFailures: 0,
        cooldownUntil: undefined,
        cooldownReason: undefined,
        cooldownKind: undefined,
        lastSeenAt: event.at,
      };
    }
  }
  return health;
}

function applyReplayedCooldown(
  health: Partial<Record<AgentId, AgentHealth>>,
  agentId: AgentId,
  options: {reason: string; resetHint?: string; kind: CooldownKind},
  now: number,
): void {
  const current = health[agentId] ?? createAgentHealth(agentId);
  const resetAtMs = parseResetHint(options.resetHint, now);
  health[agentId] = recordTransientFailure(current, {resetAtMs, reason: options.reason, kind: options.kind}, now);
}

function fallbackAvailabilityReason(availability: 'AUTH_ERROR' | 'SIGNED_OUT' | 'UNHEALTHY'): string {
  if (availability === 'AUTH_ERROR') return 'authentication failed';
  if (availability === 'SIGNED_OUT') return 'signed out';
  return 'unhealthy';
}
