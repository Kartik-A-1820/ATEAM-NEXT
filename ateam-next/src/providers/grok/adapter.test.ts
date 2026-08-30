import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {beforeEach, describe, expect, it} from 'vitest';
import type {AteamEvent} from '../../domain/events.js';
import type {ProcessResult} from '../../process/runner.js';
import {GrokAdapter, grokRunOnceArgs, normalizeGrokProbe, type GrokProcessIo} from './adapter.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('grokRunOnceArgs', () => {
  it('uses explicit argv for the structured JSON path', () => {
    expect(grokRunOnceArgs('fix auth', '/repo')).toEqual(['-p', 'fix auth', '--cwd', '/repo', '--output-format', 'json']);
  });
});

describe('normalizeGrokProbe', () => {
  it('treats inspect JSON as ready without fabricating auth or quota', () => {
    const stdout = readFileSync(join(fixtures, 'inspect_ready.json'), 'utf8');
    expect(normalizeGrokProbe(stdout, '', 0)).toEqual({availability: 'READY', version: '1.0.13'});
  });

  it('does not treat loginPolicy fields as an auth failure', () => {
    const stdout = readFileSync(join(fixtures, 'inspect_ready.json'), 'utf8');
    expect(normalizeGrokProbe(stdout, '', 1)).toMatchObject({availability: 'READY', version: '1.0.13'});
  });

  it('maps version output to ready', () => {
    expect(normalizeGrokProbe('grok 1.0.13 (5e9a58528b76) [stable]', '', 0)).toEqual({
      availability: 'READY',
      version: '1.0.13',
    });
  });

  it('maps auth-looking probe output to AUTH_ERROR', () => {
    expect(normalizeGrokProbe('', 'Authentication failed: please login', 1)).toMatchObject({availability: 'AUTH_ERROR'});
  });

  it('maps rate-limit-looking probe output to RATE_LIMITED', () => {
    expect(normalizeGrokProbe('', 'rate limit exceeded retry-after: 30s', 1)).toMatchObject({availability: 'RATE_LIMITED'});
  });

  it('keeps unrecognized inspect failures unknown so the adapter can fall back', () => {
    expect(normalizeGrokProbe('', 'unrecognized subcommand inspect', 2)).toMatchObject({availability: 'UNKNOWN'});
  });
});

describe('GrokAdapter', () => {
  beforeEach(() => {
    process.env.OMNIROUTE_API_KEY = '';
  });

  it('has id grok', () => {
    expect(new GrokAdapter().id).toBe('grok');
  });

  it('probes inspect --json first and stops on a conclusive result', async () => {
    const calls: string[][] = [];
    const adapter = new GrokAdapter('grok', '/work', io({
      run: async spec => {
        calls.push(spec.args);
        return result({stdout: readFileSync(join(fixtures, 'inspect_ready.json'), 'utf8'), args: spec.args});
      },
    }));

    await expect(adapter.probe()).resolves.toEqual({availability: 'READY', version: '1.0.13'});
    expect(calls).toEqual([['inspect', '--json']]);
  });

  it('falls back from inspect to models then --version', async () => {
    const calls: string[][] = [];
    const adapter = new GrokAdapter('grok', '/work', io({
      run: async spec => {
        calls.push(spec.args);
        if (spec.args[0] === '--version') {
          return result({stdout: 'grok 1.0.13 (deadbeef) [stable]', args: spec.args});
        }
        return result({stdout: '', stderr: 'unrecognized subcommand', exitCode: 2, args: spec.args});
      },
    }));

    await expect(adapter.probe()).resolves.toEqual({availability: 'READY', version: '1.0.13'});
    expect(calls).toEqual([['inspect', '--json'], ['models'], ['--version']]);
  });

  it('maps a missing executable to NOT_INSTALLED', async () => {
    const adapter = new GrokAdapter('grok', '/work', io({
      run: async () => {
        throw new Error('spawn grok ENOENT');
      },
    }));
    await expect(adapter.probe()).resolves.toMatchObject({availability: 'NOT_INSTALLED'});
  });

  it('runOnce uses -p, --cwd, and --output-format json', async () => {
    let seen: string[] | undefined;
    const adapter = new GrokAdapter('grok', '/work', io({
      stream: async spec => {
        seen = spec.args;
        return result({stdout: readFileSync(join(fixtures, 'normal.json'), 'utf8'), args: spec.args});
      },
    }));

    const events = await adapter.runOnce('summarize auth');
    expect(seen).toEqual(['-p', 'summarize auth', '--cwd', '/work', '--output-format', 'json']);
    expect(events.some(event => event.type === 'AgentStreamDelta')).toBe(true);
    expect(events.at(-1)).toMatchObject({type: 'AgentAvailabilityChanged', availability: 'READY'});
  });

  it('runOnce normalizes empty stdout auth failures', async () => {
    const adapter = new GrokAdapter('grok', '/work', io({
      stream: async () => result({stdout: '', stderr: 'not authenticated', exitCode: 1}),
    }));
    const events = await adapter.runOnce('hello');
    expect(events[0]).toMatchObject({type: 'AgentAvailabilityChanged', availability: 'AUTH_ERROR'});
  });

  it('runOnce normalizes empty stdout rate limits', async () => {
    const adapter = new GrokAdapter('grok', '/work', io({
      stream: async () => result({stdout: '', stderr: 'too many requests', exitCode: 1}),
    }));
    expect((await adapter.runOnce('hello'))[0]).toMatchObject({type: 'RateLimited', agentId: 'grok'});
  });

  it('runOnce maps malformed JSON to RuntimeError', async () => {
    const adapter = new GrokAdapter('grok', '/work', io({
      stream: async () => result({stdout: '{broken'}),
    }));
    expect((await adapter.runOnce('hello'))[0]).toMatchObject({type: 'RuntimeError'});
  });

  it('runOnce maps timeouts and aborts to RuntimeError', async () => {
    const timedOut = new GrokAdapter('grok', '/work', io({
      stream: async () => result({timedOut: true, exitCode: null}),
    }));
    const aborted = new GrokAdapter('grok', '/work', io({
      stream: async () => result({aborted: true, exitCode: null}),
    }));
    expect((await timedOut.runOnce('hello'))[0]).toMatchObject({type: 'RuntimeError', message: 'Grok execution timed out'});
    expect((await aborted.runOnce('hello'))[0]).toMatchObject({type: 'RuntimeError', message: 'Grok execution aborted'});
  });

  it('runStreaming emits events for earlier lines before the process closes', async () => {
    const events: AteamEvent[] = [];
    let eventsAfterFirstChunk = 0;
    let closed = false;
    const firstLine = '{"type":"assistant","text":"First "}';
    const secondLine = '{"type":"message_chunk","delta":"second"}';

    const adapter = new GrokAdapter('grok', '/work', io({
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
    expect(events.some(event => event.type === 'AgentStreamDelta' && event.delta === 'First ')).toBe(true);
    expect(events.some(event => event.type === 'AgentStreamDelta' && event.delta === 'second')).toBe(true);
  });

  it('runStreaming aborts the injected stream via the shared abortController', async () => {
    let streamSignal: AbortSignal | undefined;
    const adapter = new GrokAdapter('grok', '/work', io({
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

function io(partial: Partial<GrokProcessIo>): GrokProcessIo {
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
    executable: 'grok',
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
