import {runProcess, streamProcess} from '../../process/runner.js';
import type {AteamEvent, ExecutableProviderAdapter} from '../../domain/events.js';
import type {AgentAvailability} from '../../domain/types.js';
import {classifyCodexFailureText, parseCodexJsonl} from './parser.js';

export class CodexAdapter implements ExecutableProviderAdapter {
  readonly id = 'codex' as const;
  private abortController?: AbortController;

  constructor(private readonly executable = 'codex', private readonly cwd = process.cwd()) {}

  async probe(): Promise<{availability: AgentAvailability; version?: string; reason?: string}> {
    try {
      const result = await runProcess({executable: this.executable, args: ['doctor', '--json'], cwd: this.cwd, timeoutMs: 8000});
      return normalizeCodexDoctor(result.stdout, result.stderr, result.exitCode ?? -1);
    } catch (error) {
      return {availability: 'NOT_INSTALLED', reason: error instanceof Error ? error.message : String(error)};
    }
  }

  async startSession(send: (event: AteamEvent) => void, signal: AbortSignal): Promise<void> {
    signal.addEventListener('abort', () => void this.cancel(), {once: true});
    send({type: 'AgentAvailabilityChanged', agentId: 'codex', availability: 'READY', at: Date.now()});
  }

  async send(message: string): Promise<void> {
    this.abortController = new AbortController();
    await runProcess({
      executable: this.executable,
      args: ['exec', '--cd', this.cwd, '--skip-git-repo-check', '--json', '-'],
      cwd: this.cwd,
      stdin: message,
      signal: this.abortController.signal,
    });
  }

  async runOnce(message: string): Promise<AteamEvent[]> {
    const events: AteamEvent[] = [];
    await this.runStreaming(message, event => events.push(event), new AbortController().signal);
    return events;
  }

  async runStreaming(message: string, onEvent: (event: AteamEvent) => void, signal: AbortSignal): Promise<void> {
    this.abortController = new AbortController();
    const forwardAbort = () => void this.cancel();
    if (signal.aborted) forwardAbort();
    else signal.addEventListener('abort', forwardAbort, {once: true});

    let stdoutBuffer = '';
    let emittedCount = 0;
    const emitLine = (line: string) => {
      for (const event of parseCodexJsonl(line)) {
        emittedCount += 1;
        onEvent(event);
      }
    };
    const emitStdoutChunk = (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        emitLine(line.endsWith('\r') ? line.slice(0, -1) : line);
      }
    };

    let result: Awaited<ReturnType<typeof streamProcess>>;
    try {
      result = await streamProcess({
        executable: this.executable,
        args: ['exec', '--cd', this.cwd, '--skip-git-repo-check', '--json', '-'],
        cwd: this.cwd,
        stdin: message,
        signal: this.abortController.signal,
        onStdout: emitStdoutChunk,
      });
    } finally {
      signal.removeEventListener('abort', forwardAbort);
    }

    if (stdoutBuffer.length > 0) {
      emitLine(stdoutBuffer.endsWith('\r') ? stdoutBuffer.slice(0, -1) : stdoutBuffer);
    }
    if (result.timedOut || result.aborted) {
      onEvent({type: 'RuntimeError', message: result.timedOut ? 'Codex execution timed out' : 'Codex execution aborted', at: Date.now()});
      return;
    }
    const combined = `${result.stdout}\n${result.stderr}`;
    if (result.exitCode !== 0 && result.stdout.trim().length === 0) {
      onEvent(classifyCodexFailureText(result.stderr.trim() || `Codex exited ${result.exitCode}`));
      return;
    }
    if (result.exitCode !== 0 && emittedCount === 0) {
      onEvent(classifyCodexFailureText(combined.trim() || `Codex exited ${result.exitCode}`));
    }
  }

  async cancel(): Promise<void> {
    this.abortController?.abort();
  }

  async shutdown(): Promise<void> {
    await this.cancel();
  }
}

function extractVersion(output: string): string | undefined {
  const match = output.match(/"codexVersion"\s*:\s*"([^"]+)"/) ?? output.match(/codex(?:-cli)?\s+([0-9.]+)/i);
  return match?.[1];
}

export function normalizeCodexDoctor(stdout: string, stderr: string, exitCode: number): {availability: AgentAvailability; version?: string; reason?: string} {
  const version = extractVersion(stdout) ?? extractVersion(stderr);
  const parsed = parseDoctorJson(stdout);
  if (exitCode === 0) return {availability: 'READY', version};

  const authStatus = doctorCheckStatus(parsed, 'auth.credentials');
  if (authStatus === 'fail' || authStatus === 'warning') {
    return {availability: 'AUTH_ERROR', version, reason: 'codex auth check failed'};
  }
  if (parsed && authStatus === 'ok') {
    const blocking = blockingDoctorCheck(parsed);
    if (blocking) {
      return {availability: 'UNHEALTHY', version, reason: blocking.summary ?? `codex doctor exited ${exitCode}`};
    }
    const nonBlocking = nonBlockingDoctorCheck(parsed);
    return {availability: 'READY', version, reason: nonBlocking?.summary ?? `codex doctor exited ${exitCode}`};
  }

  const plain = `${stdout}\n${stderr}`.toLowerCase();
  if (plain.includes('not authenticated') || plain.includes('login required') || plain.includes('auth failed')) {
    return {availability: 'AUTH_ERROR', version, reason: 'codex doctor reported auth issue'};
  }
  return {availability: 'UNHEALTHY', version, reason: stderr.trim() || `codex doctor exited ${exitCode}`};
}

function parseDoctorJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}

function doctorCheckStatus(parsed: unknown, id: string): string | undefined {
  if (!parsed || typeof parsed !== 'object' || !('checks' in parsed)) return undefined;
  const checks = (parsed as {checks?: Record<string, unknown>}).checks;
  const check = checks?.[id];
  if (!check || typeof check !== 'object' || !('status' in check)) return undefined;
  return String((check as {status?: unknown}).status);
}

function blockingDoctorCheck(parsed: unknown): {id: string; summary?: string} | undefined {
  for (const issue of doctorIssues(parsed)) {
    if (issue.status === 'fail' && !issue.id.startsWith('terminal.')) {
      return issue;
    }
  }
  return undefined;
}

function nonBlockingDoctorCheck(parsed: unknown): {id: string; summary?: string} | undefined {
  return doctorIssues(parsed)[0];
}

function doctorIssues(parsed: unknown): Array<{id: string; status: string; summary?: string}> {
  if (!parsed || typeof parsed !== 'object' || !('checks' in parsed)) return [];
  const checks = (parsed as {checks?: Record<string, {status?: unknown; summary?: unknown}>}).checks ?? {};
  const issues: Array<{id: string; status: string; summary?: string}> = [];
  for (const [id, check] of Object.entries(checks)) {
    if (check.status === 'fail' || check.status === 'warning') {
      issues.push({id, status: String(check.status), summary: typeof check.summary === 'string' ? check.summary : undefined});
    }
  }
  return issues;
}
