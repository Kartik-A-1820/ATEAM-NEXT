import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {AteamEvent} from '../../domain/events.js';
import type {ProcessResult, StreamingProcessSpec} from '../../process/runner.js';
import {streamProcess} from '../../process/runner.js';
import {CodexAdapter, normalizeCodexDoctor} from './adapter.js';

vi.mock('../../process/runner.js', () => ({
  runProcess: vi.fn(),
  streamProcess: vi.fn(),
}));

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const streamProcessMock = vi.mocked(streamProcess);

function processResult(stdout: string, stderr = '', exitCode = 0): ProcessResult {
  return {
    executable: 'codex',
    args: [],
    cwd: process.cwd(),
    exitCode,
    signal: null,
    stdout,
    stderr,
    durationMs: 1,
    timedOut: false,
    aborted: false,
  };
}

beforeEach(() => {
  streamProcessMock.mockReset();
});

describe('CodexAdapter', () => {
  it('streams parsed stdout events before the process closes', async () => {
    const events: AteamEvent[] = [];
    let processClosed = false;
    let sawFirstDeltaBeforeClose = false;
    const stdout = '{"type":"delta","delta":"Hello "}\n{"type":"delta","delta":"world"}\n';
    streamProcessMock.mockImplementation(async (spec: StreamingProcessSpec) => {
      spec.onStdout?.('{"type":"delta","delta":"Hello "}\n{"type":"delta"');
      await Promise.resolve();
      spec.onStdout?.(',"delta":"world"}\n');
      processClosed = true;
      return processResult(stdout);
    });

    await new CodexAdapter('codex', process.cwd()).runStreaming('task', event => {
      events.push(event);
      if (event.type === 'AgentStreamDelta' && event.delta === 'Hello ') {
        sawFirstDeltaBeforeClose = !processClosed;
      }
    }, new AbortController().signal);

    expect(sawFirstDeltaBeforeClose).toBe(true);
    expect(events.filter(event => event.type === 'AgentStreamDelta').map(event => event.delta)).toEqual(['Hello ', 'world']);
  });

  it('keeps runOnce as the buffered event collector', async () => {
    const stdout = readFileSync(join(fixtures, 'normal.jsonl'), 'utf8');
    streamProcessMock.mockImplementation(async (spec: StreamingProcessSpec) => {
      spec.onStdout?.(stdout);
      return processResult(stdout);
    });

    const events = await new CodexAdapter('codex', process.cwd()).runOnce('task');

    expect(events).toContainEqual(expect.objectContaining({type: 'AgentStreamDelta', agentId: 'codex', delta: 'Hello '}));
    expect(events.some(event => event.type === 'ToolStarted')).toBe(true);
    expect(events.at(-1)).toMatchObject({type: 'AgentAvailabilityChanged', availability: 'READY'});
  });

  it('keeps process args unchanged when images are omitted', async () => {
    streamProcessMock.mockImplementation(async () => processResult(''));

    await new CodexAdapter('codex', 'F:\\repo').runStreaming('task', () => undefined, new AbortController().signal);

    expect(streamProcessMock.mock.calls[0]?.[0].args).toEqual([
      'exec',
      '--cd',
      'F:\\repo',
      '--skip-git-repo-check',
      '--json',
      '-',
    ]);
  });

  it('passes image attachments through to codex exec', async () => {
    streamProcessMock.mockImplementation(async () => processResult(''));

    await new CodexAdapter('codex', 'F:\\repo').runStreaming(
      'task',
      () => undefined,
      new AbortController().signal,
      ['F:\\images\\one.png', 'F:\\images\\two.jpg'],
    );

    expect(streamProcessMock.mock.calls[0]?.[0].args).toEqual([
      'exec',
      '--cd',
      'F:\\repo',
      '--skip-git-repo-check',
      '--json',
      '-i',
      'F:\\images\\one.png',
      '-i',
      'F:\\images\\two.jpg',
      '-',
    ]);
  });

  it('forwards runOnce image attachments to runStreaming', async () => {
    streamProcessMock.mockImplementation(async () => processResult(''));

    await new CodexAdapter('codex', 'F:\\repo').runOnce('task', ['F:\\images\\one.png']);

    expect(streamProcessMock.mock.calls[0]?.[0].args).toContain('F:\\images\\one.png');
  });
});

describe('normalizeCodexDoctor', () => {
  it('keeps auth-ready Codex ready when only terminal doctor checks fail', () => {
    const stdout = JSON.stringify({
      overallStatus: 'fail',
      codexVersion: '0.151.0',
      checks: {
        'auth.credentials': {status: 'ok', summary: 'auth is configured'},
        'terminal.env': {status: 'fail', summary: 'TERM=dumb - colors and cursor control are disabled'},
      },
    });

    expect(normalizeCodexDoctor(stdout, '', 1)).toEqual({
      availability: 'READY',
      version: '0.151.0',
      reason: 'TERM=dumb - colors and cursor control are disabled',
    });
  });

  it('does not let non-blocking warnings mask terminal-only failures', () => {
    const stdout = JSON.stringify({
      overallStatus: 'fail',
      codexVersion: '0.151.0',
      checks: {
        'auth.credentials': {status: 'ok', summary: 'auth is configured'},
        'git.worktree.dev_drive': {status: 'warning', summary: 'not on a Windows Dev Drive'},
        'terminal.env': {status: 'fail', summary: 'TERM=dumb - colors and cursor control are disabled'},
      },
    });

    expect(normalizeCodexDoctor(stdout, '', 1)).toEqual({
      availability: 'READY',
      version: '0.151.0',
      reason: 'not on a Windows Dev Drive',
    });
  });


  it('treats non-terminal failed doctor checks as unhealthy', () => {
    const stdout = JSON.stringify({
      overallStatus: 'fail',
      codexVersion: '0.151.0',
      checks: {
        'auth.credentials': {status: 'ok', summary: 'auth is configured'},
        'network.provider_reachability': {status: 'fail', summary: 'provider endpoints unreachable'},
      },
    });

    expect(normalizeCodexDoctor(stdout, '', 1)).toEqual({
      availability: 'UNHEALTHY',
      version: '0.151.0',
      reason: 'provider endpoints unreachable',
    });
  });

  it('reports auth error only when the auth check fails', () => {
    const stdout = JSON.stringify({
      overallStatus: 'fail',
      codexVersion: '0.151.0',
      checks: {
        'auth.credentials': {status: 'fail', summary: 'auth is not configured'},
      },
    });

    expect(normalizeCodexDoctor(stdout, '', 1)).toMatchObject({
      availability: 'AUTH_ERROR',
      version: '0.151.0',
    });
  });

  it('falls back to plain text auth detection when JSON is unavailable', () => {
    expect(normalizeCodexDoctor('', 'not authenticated', 1)).toMatchObject({availability: 'AUTH_ERROR'});
  });
});
