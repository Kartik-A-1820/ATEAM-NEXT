import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import type {AteamEvent} from '../../domain/events.js';
import type {ProcessResult} from '../../process/runner.js';
import {AgyAdapter, agyRunOnceArgs, normalizeAgyProbe, type AgyProcessIo} from './adapter.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

// ---------------------------------------------------------------------------
// normalizeAgyProbe — unit tests
// ---------------------------------------------------------------------------

describe('normalizeAgyProbe — via models', () => {
  it('returns READY when exit code is 0', () => {
    const result = normalizeAgyProbe('["agy-2","agy-flash"]', '', 0, 'models');
    expect(result.availability).toBe('READY');
  });

  it('extracts semver from models output', () => {
    const result = normalizeAgyProbe('agy 1.4.2\n["agy-2"]', '', 0, 'models');
    expect(result.version).toBe('1.4.2');
  });

  it('extracts version from JSON field', () => {
    const result = normalizeAgyProbe('{"version":"2.0.0","models":["agy-2"]}', '', 0, 'models');
    expect(result.version).toBe('2.0.0');
  });

  it('returns AUTH_ERROR when stderr contains not authenticated', () => {
    const result = normalizeAgyProbe('', 'Error: not authenticated. Run `agy login`.', 1, 'models');
    expect(result.availability).toBe('AUTH_ERROR');
  });

  it('returns AUTH_ERROR when stderr contains 403', () => {
    const result = normalizeAgyProbe('', 'HTTP 403 Forbidden', 1, 'models');
    expect(result.availability).toBe('AUTH_ERROR');
  });

  it('returns AUTH_ERROR on sign in hint', () => {
    const result = normalizeAgyProbe('', 'Please sign in to continue', 1, 'models');
    expect(result.availability).toBe('AUTH_ERROR');
  });

  it('returns RATE_LIMITED on 429 in stderr', () => {
    const result = normalizeAgyProbe('', 'Error 429: rate limit exceeded', 1, 'models');
    expect(result.availability).toBe('RATE_LIMITED');
  });

  it('returns RATE_LIMITED on quota message', () => {
    const result = normalizeAgyProbe('', 'quota exceeded for this period', 1, 'models');
    expect(result.availability).toBe('RATE_LIMITED');
  });

  it('returns UNHEALTHY for unknown non-zero exit', () => {
    const result = normalizeAgyProbe('', 'internal server error', 1, 'models');
    expect(result.availability).toBe('UNHEALTHY');
    expect(result.reason).toContain('internal server error');
  });
});

describe('normalizeAgyProbe — via version', () => {
  it('returns READY when exit code is 0', () => {
    const result = normalizeAgyProbe('agy 0.9.5', '', 0, 'version');
    expect(result.availability).toBe('READY');
    expect(result.version).toBe('0.9.5');
  });

  it('returns NOT_INSTALLED-like UNHEALTHY when stderr is empty and non-zero', () => {
    const result = normalizeAgyProbe('', '', 127, 'version');
    expect(result.availability).toBe('UNHEALTHY');
  });

  it('falls back to stdout for the unhealthy reason when stderr is empty', () => {
    const result = normalizeAgyProbe('command not found', '', 127, 'version');
    expect(result.reason).toContain('command not found');
  });
});

describe('normalizeAgyProbe — version extraction edge cases', () => {
  it('extracts v-prefixed version', () => {
    const result = normalizeAgyProbe('agy v1.10.0-beta', '', 0, 'version');
    expect(result.version).toBe('1.10.0-beta');
  });

  it('returns undefined version when no version string present', () => {
    const result = normalizeAgyProbe('[]', '', 0, 'models');
    expect(result.version).toBeUndefined();
  });
});

describe('agyRunOnceArgs', () => {
  it('uses explicit argv for the structured JSON path', () => {
    expect(agyRunOnceArgs('hello')).toEqual(['-p', 'hello', '--output-format', 'json']);
  });

  it('does not invent an image flag when attachments are provided', () => {
    expect(agyRunOnceArgs('hello', ['/abs/shot.png'])).toEqual(['-p', 'hello', '--output-format', 'json']);
  });
});

describe('AgyAdapter', () => {
  it('has id agy', () => {
    expect(new AgyAdapter().id).toBe('agy');
  });

  it('runOnce returns the full parsed event array for a completion fixture', async () => {
    let seen: string[] | undefined;
    const stdout = readFileSync(join(fixtures, 'completion.json'), 'utf8');
    const adapter = new AgyAdapter('agy', '/work', io({
      stream: async spec => {
        seen = spec.args;
        return result({stdout, args: spec.args});
      },
    }));

    const events = await adapter.runOnce('hello');
    expect(seen).toEqual(['-p', 'hello', '--output-format', 'json']);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'AgentStreamDelta',
      agentId: 'agy',
      delta: 'Hello, world! How can I help you today?',
    }));
    expect(events.at(-1)).toMatchObject({type: 'AgentAvailabilityChanged', availability: 'READY'});
  });

  it('runOnce accepts images and leaves argv unchanged when the CLI has no attachment flag', async () => {
    let seen: string[] | undefined;
    const stdout = readFileSync(join(fixtures, 'completion.json'), 'utf8');
    const adapter = new AgyAdapter('agy', '/work', io({
      stream: async spec => {
        seen = spec.args;
        return result({stdout, args: spec.args});
      },
    }));

    await adapter.runOnce('hello', ['/abs/shot.png']);
    expect(seen).toEqual(['-p', 'hello', '--output-format', 'json']);
  });

  it('runOnce maps timeouts and aborts to RuntimeError', async () => {
    const timedOut = new AgyAdapter('agy', '/work', io({
      stream: async () => result({timedOut: true, exitCode: null}),
    }));
    const aborted = new AgyAdapter('agy', '/work', io({
      stream: async () => result({aborted: true, exitCode: null}),
    }));
    expect((await timedOut.runOnce('hello'))[0]).toMatchObject({type: 'RuntimeError', message: 'AGY execution timed out'});
    expect((await aborted.runOnce('hello'))[0]).toMatchObject({type: 'RuntimeError', message: 'AGY execution aborted'});
  });

  it('runStreaming emits events for earlier lines before the process closes', async () => {
    const events: AteamEvent[] = [];
    let eventsAfterFirstChunk = 0;
    let closed = false;
    const firstLine = '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello "}}';
    const secondLine = '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"world"}}';

    const adapter = new AgyAdapter('agy', '/work', io({
      stream: async spec => {
        spec.onStdout?.(`${firstLine}\n`);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        eventsAfterFirstChunk = events.length;
        expect(closed).toBe(false);
        spec.onStdout?.(`${secondLine}\n`);
        closed = true;
        return result({stdout: `${firstLine}\n${secondLine}\n`, args: spec.args});
      },
    }));

    await adapter.runStreaming('hello', event => events.push(event), new AbortController().signal);

    expect(eventsAfterFirstChunk).toBeGreaterThan(0);
    expect(events.some(event => event.type === 'AgentStreamDelta' && event.delta === 'Hello ')).toBe(true);
    expect(events.some(event => event.type === 'AgentStreamDelta' && event.delta === 'world')).toBe(true);
  });

  it('runStreaming aborts the injected stream via the shared abortController', async () => {
    let streamSignal: AbortSignal | undefined;
    const adapter = new AgyAdapter('agy', '/work', io({
      stream: async spec => {
        streamSignal = spec.signal;
        if (spec.signal && !spec.signal.aborted) {
          await new Promise<void>(resolve => {
            spec.signal?.addEventListener('abort', () => resolve(), {once: true});
          });
        }
        return result({aborted: true, exitCode: null, args: spec.args});
      },
    }));
    const controller = new AbortController();
    const pending = adapter.runStreaming('hello', () => undefined, controller.signal);
    controller.abort();
    await pending;
    expect(streamSignal?.aborted).toBe(true);
  });
});

function io(partial: Partial<AgyProcessIo>): AgyProcessIo {
  return {
    run: partial.run ?? (async () => {
      throw new Error('run not expected');
    }),
    stream: partial.stream ?? (async () => {
      throw new Error('stream not expected');
    }),
  };
}

function result(partial: Partial<ProcessResult> = {}): ProcessResult {
  return {
    executable: 'agy',
    args: [],
    cwd: '/work',
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    durationMs: 1,
    timedOut: false,
    aborted: false,
    ...partial,
  };
}
