import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {AteamEvent} from '../../domain/events.js';
import type {ProcessResult, StreamingProcessSpec} from '../../process/runner.js';
import {streamProcess} from '../../process/runner.js';
import {ClaudeAdapter} from './adapter.js';

vi.mock('../../process/runner.js', () => ({
  runProcess: vi.fn(),
  streamProcess: vi.fn(),
}));

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const streamProcessMock = vi.mocked(streamProcess);

function processResult(stdout: string, stderr = '', exitCode = 0): ProcessResult {
  return {
    executable: 'claude',
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

describe('ClaudeAdapter', () => {
  it('streams parsed stdout events before the process closes', async () => {
    const events: AteamEvent[] = [];
    let processClosed = false;
    let sawFirstDeltaBeforeClose = false;
    const stdout = '{"type":"assistant","text":"First "}\n{"type":"assistant","text":"second"}\n';
    streamProcessMock.mockImplementation(async (spec: StreamingProcessSpec) => {
      spec.onStdout?.('{"type":"assistant","text":"First "}\n{"type":"assistant"');
      await Promise.resolve();
      spec.onStdout?.(',"text":"second"}\n');
      processClosed = true;
      return processResult(stdout);
    });

    await new ClaudeAdapter('claude', process.cwd()).runStreaming('task', event => {
      events.push(event);
      if (event.type === 'AgentStreamDelta' && event.delta === 'First ') {
        sawFirstDeltaBeforeClose = !processClosed;
      }
    }, new AbortController().signal);

    expect(sawFirstDeltaBeforeClose).toBe(true);
    expect(events.filter(event => event.type === 'AgentStreamDelta').map(event => event.delta)).toEqual(['First ', 'second']);
  });

  it('keeps runOnce as the buffered event collector', async () => {
    const stdout = readFileSync(join(fixtures, 'streaming.jsonl'), 'utf8');
    streamProcessMock.mockImplementation(async (spec: StreamingProcessSpec) => {
      spec.onStdout?.(stdout);
      return processResult(stdout);
    });

    const events = await new ClaudeAdapter('claude', process.cwd()).runOnce('task');

    expect(events.filter(event => event.type === 'AgentStreamDelta').map(event => event.delta)).toEqual(['First ', 'second']);
    expect(events.some(event => event.type === 'ToolStarted')).toBe(true);
    expect(events.some(event => event.type === 'ToolFinished')).toBe(true);
  });
});
