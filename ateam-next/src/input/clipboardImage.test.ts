import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {ProcessResult} from '../process/runner.js';
import {runProcess} from '../process/runner.js';

vi.mock('../process/runner.js', () => ({
  runProcess: vi.fn(),
}));

const runProcessMock = vi.mocked(runProcess);

function processResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    executable: 'x',
    args: [],
    cwd: process.cwd(),
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    durationMs: 1,
    timedOut: false,
    aborted: false,
    ...overrides,
  };
}

describe('commandForPlatform', () => {
  it('returns a powershell command on win32', async () => {
    const {commandForPlatform} = await import('./clipboardImage.js');
    expect(commandForPlatform('win32')?.executable).toBe('powershell.exe');
  });

  it('returns an osascript command on darwin', async () => {
    const {commandForPlatform} = await import('./clipboardImage.js');
    expect(commandForPlatform('darwin')?.executable).toBe('osascript');
  });

  it('returns a shell command on linux', async () => {
    const {commandForPlatform} = await import('./clipboardImage.js');
    expect(commandForPlatform('linux')?.executable).toBe('sh');
  });

  it('returns undefined for unsupported platforms', async () => {
    const {commandForPlatform} = await import('./clipboardImage.js');
    expect(commandForPlatform('aix')).toBeUndefined();
  });
});

describe('captureClipboardImage', () => {
  beforeEach(() => {
    runProcessMock.mockReset();
  });

  it('reports failure for an unsupported platform without spawning anything', async () => {
    const {captureClipboardImage} = await import('./clipboardImage.js');
    const result = await captureClipboardImage('aix');
    expect(result.ok).toBe(false);
    expect(runProcessMock).not.toHaveBeenCalled();
  });

  it('reports failure when the clipboard tool exits non-zero', async () => {
    runProcessMock.mockResolvedValue(processResult({exitCode: 1, stderr: 'no image'}));
    const {captureClipboardImage} = await import('./clipboardImage.js');
    const result = await captureClipboardImage('linux');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('no image');
  });

  it('reports success and returns the path when the tool writes a non-empty file', async () => {
    let capturedPath = '';
    runProcessMock.mockImplementation(async spec => {
      const pathArg = spec.args.find(arg => arg.includes('.png'));
      capturedPath = pathArg?.match(/'([^']+\.png)'/)?.[1] ?? '';
      const {writeFileSync} = await import('node:fs');
      if (capturedPath) writeFileSync(capturedPath, Buffer.from([1, 2, 3]));
      return processResult({exitCode: 0});
    });
    const {captureClipboardImage} = await import('./clipboardImage.js');
    const result = await captureClipboardImage('linux');
    expect(result.ok).toBe(true);
    expect(result.path).toBe(capturedPath);
    if (result.path) rmSync(result.path, {force: true});
  });
});

// Sanity check that the temp-dir helper this module relies on behaves as expected on this OS.
describe('temp dir sanity', () => {
  it('mkdtempSync produces a directory that exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ateam-paste-test-'));
    expect(existsSync(dir)).toBe(true);
    rmSync(dir, {recursive: true, force: true});
  });
});
