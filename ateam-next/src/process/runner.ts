import {spawn, spawnSync} from 'node:child_process';
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

export interface StreamingProcessSpec extends ProcessSpec {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export async function runProcess(spec: ProcessSpec): Promise<ProcessResult> {
  const started = Date.now();
  let timedOut = false;
  let aborted = false;
  const resolved = resolveExecutable(spec.executable);
  const spawnSpec = commandForSpawn(resolved, spec.args);

  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(spawnSpec.executable, spawnSpec.args, {
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
        executable: resolved,
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

export async function streamProcess(spec: StreamingProcessSpec): Promise<ProcessResult> {
  const started = Date.now();
  let timedOut = false;
  let aborted = false;
  const resolved = resolveExecutable(spec.executable);
  const spawnSpec = commandForSpawn(resolved, spec.args);

  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(spawnSpec.executable, spawnSpec.args, {
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
        executable: resolved,
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
      if (child.pid !== undefined) await terminateProcessTree(child.pid);
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
    child.stdout.on('data', chunk => {
      const buffer = Buffer.from(chunk);
      stdout.push(buffer);
      spec.onStdout?.(buffer.toString('utf8'));
    });
    child.stderr.on('data', chunk => {
      const buffer = Buffer.from(chunk);
      stderr.push(buffer);
      spec.onStderr?.(buffer.toString('utf8'));
    });

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

    child.stdin.end(spec.stdin ?? '');
  });
}

export function resolveExecutable(executable: string): string {
  if (process.platform !== 'win32' || executable.includes('\\') || executable.includes('/')) {
    return executable;
  }
  const result = spawnSync('where.exe', [executable], {encoding: 'utf8', windowsHide: true});
  const candidates = result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return candidates.find(candidate => /\.(exe|cmd|bat)$/i.test(candidate)) ?? candidates[0] ?? executable;
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

function commandForSpawn(executable: string, args: string[]): {executable: string; args: string[]} {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    return {
      executable: 'cmd.exe',
      args: ['/d', '/c', executable, ...args],
    };
  }
  return {executable, args};
}
