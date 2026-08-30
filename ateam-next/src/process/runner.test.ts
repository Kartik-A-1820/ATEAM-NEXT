import {describe, expect, it} from 'vitest';
import process from 'node:process';
import {resolveExecutable, runProcess, streamProcess} from './runner.js';

describe('process runner', () => {
  it('runs an executable with explicit argv and captures stdout/stderr separately', async () => {
    const result = await runProcess({
      executable: process.execPath,
      args: ['-e', "process.stdout.write('out'); process.stderr.write('err');"],
      cwd: process.cwd(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('out');
    expect(result.stderr).toBe('err');
  });

  it('terminates a timed out child process', async () => {
    const result = await runProcess({
      executable: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 5000);'],
      cwd: process.cwd(),
      timeoutMs: 100,
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it('resolves executables through PATH on Windows', () => {
    expect(resolveExecutable(process.execPath)).toBe(process.execPath);
  });

  it('streams stdout chunks while retaining final output', async () => {
    const chunks: string[] = [];
    const result = await streamProcess({
      executable: process.execPath,
      args: ['-e', "process.stdout.write('a'); setTimeout(() => process.stdout.write('b'), 20);"],
      cwd: process.cwd(),
      onStdout: chunk => chunks.push(chunk),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ab');
    expect(chunks.join('')).toBe('ab');
  });
});
