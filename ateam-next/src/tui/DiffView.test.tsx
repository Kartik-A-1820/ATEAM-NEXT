import React from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {render} from 'ink-testing-library';
import {DiffView, buildDiffLines, classifyDiffLine} from './DiffView.js';
import {runProcess} from '../process/runner.js';

vi.mock('../process/runner.js', () => ({
  runProcess: vi.fn(),
}));

const runProcessMock = vi.mocked(runProcess);

describe('DiffView', () => {
  beforeEach(() => {
    runProcessMock.mockReset();
  });

  it('classifies additions, deletions, and hunk headers', () => {
    expect(classifyDiffLine('+added')).toEqual({text: '+added', kind: 'addition'});
    expect(classifyDiffLine('-removed')).toEqual({text: '-removed', kind: 'deletion'});
    expect(classifyDiffLine('@@ -1,2 +1,2 @@')).toEqual({text: '@@ -1,2 +1,2 @@', kind: 'hunk'});
    expect(classifyDiffLine('+++ b/src/file.ts')).toEqual({text: '+++ b/src/file.ts', kind: 'default'});
    expect(classifyDiffLine('--- a/src/file.ts')).toEqual({text: '--- a/src/file.ts', kind: 'default'});
  });

  it('truncates from the tail with an indicator', () => {
    const lines = buildDiffLines('', ['line 1', 'line 2', '+line 3', '-line 4'].join('\n'), 3);
    expect(lines).toEqual([
      {text: '2 more lines, showing last 2', kind: 'indicator'},
      {text: '+line 3', kind: 'addition'},
      {text: '-line 4', kind: 'deletion'},
    ]);
  });

  it('renders the no-changes message when git diff is empty', async () => {
    runProcessMock.mockResolvedValue({
      executable: 'git',
      args: [],
      cwd: process.cwd(),
      exitCode: 0,
      signal: null,
      stdout: '',
      stderr: '',
      durationMs: 1,
      timedOut: false,
      aborted: false,
    });

    const {lastFrame, unmount} = render(<DiffView height={6} />);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(lastFrame()).toContain('No workspace changes yet.');
    unmount();
  });

  it('renders a not-git-repo message distinctly', async () => {
    runProcessMock.mockResolvedValue({
      executable: 'git',
      args: [],
      cwd: process.cwd(),
      exitCode: 129,
      signal: null,
      stdout: '',
      stderr: 'fatal: not a git repository',
      durationMs: 1,
      timedOut: false,
      aborted: false,
    });

    const {lastFrame, unmount} = render(<DiffView height={6} />);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(lastFrame()).toContain('Not inside a git repository.');
    unmount();
  });

  it('renders a missing-git message distinctly', async () => {
    const error = new Error('spawn git ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    runProcessMock.mockRejectedValue(error);

    const {lastFrame, unmount} = render(<DiffView height={6} />);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(lastFrame()).toContain('git is not installed or not on PATH.');
    unmount();
  });
});
