import {spawn} from 'node:child_process';
import process from 'node:process';

export interface ProcessSpec {
  executable: string;
  args: string[];
  cwd: string;
  stdin?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export interface ProcessResult {
  executable: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
}

export async function runProcess(spec: ProcessSpec): Promise<ProcessResult> {
  const started = Date.now();
  let timedOut = false;
  let aborted = false;

  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(spec.executable, spec.args, {
      cwd: spec.cwd,
      env: {...process.env, ...spec.env},
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      spec.signal?.removeEventListener('abort', onAbort);
      resolve({
        executable: spec.executable,
        args: spec.args,
        cwd: spec.cwd,
        exitCode,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        durationMs: Date.now() - started,
        timedOut,
        aborted,
      });
    };

    const terminate = async () => {
      if (child.pid === undefined) return;
      await terminateProcessTree(child.pid);
    };

    const onAbort = () => {
      aborted = true;
      void terminate();
    };

    child.once('error', error => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      spec.signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.once('close', finish);
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));

    if (spec.signal) {
      if (spec.signal.aborted) onAbort();
      else spec.signal.addEventListener('abort', onAbort, {once: true});
    }

    if (spec.timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        timedOut = true;
        void terminate();
      }, spec.timeoutMs);
    }

    if (spec.stdin !== undefined) {
      child.stdin.end(spec.stdin);
    } else {
      child.stdin.end();
    }
  });
}

export async function terminateProcessTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await new Promise<void>(resolve => {
      const killer = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.once('close', () => resolve());
      killer.once('error', () => {
        try {
          process.kill(pid);
        } catch {
          // Process may already be gone.
        }
        resolve();
      });
    });
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process may already be gone.
    }
  }
}
