import {runProcess, streamProcess} from '../../process/runner.js';
import type {AteamEvent, ExecutableProviderAdapter} from '../../domain/events.js';
import type {AgentAvailability} from '../../domain/types.js';
import {classifyClaudeFailure, parseClaudeOutput} from './parser.js';

export class ClaudeAdapter implements ExecutableProviderAdapter {
  readonly id = 'claude' as const;
  private abortController?: AbortController;

  constructor(private readonly executable = 'claude', private readonly cwd = process.cwd()) {}

  async probe(): Promise<{availability: AgentAvailability; version?: string; reason?: string}> {
    try {
      const auth = await runProcess({executable: this.executable, args: ['auth', 'status', '--json'], cwd: this.cwd, timeoutMs: 5000});
      const parsed = parseAuth(auth.stdout);
      if (auth.exitCode === 0 && parsed.loggedIn === true) {
        const version = await probeVersion(this.executable, this.cwd);
        return {availability: 'READY', version};
      }
      return {availability: 'AUTH_ERROR', reason: auth.stderr.trim() || auth.stdout.trim() || 'claude auth status failed'};
    } catch (error) {
      return {availability: 'NOT_INSTALLED', reason: error instanceof Error ? error.message : String(error)};
    }
  }

  async startSession(send: (event: AteamEvent) => void, signal: AbortSignal): Promise<void> {
    signal.addEventListener('abort', () => void this.cancel(), {once: true});
    send({type: 'AgentAvailabilityChanged', agentId: 'claude', availability: 'READY', at: Date.now()});
  }

  async send(): Promise<void> {
    return undefined;
  }

  async runOnce(message: string, images?: string[]): Promise<AteamEvent[]> {
    const events: AteamEvent[] = [];
    await this.runStreaming(message, event => events.push(event), new AbortController().signal, images);
    return events;
  }

  async runStreaming(message: string, onEvent: (event: AteamEvent) => void, signal: AbortSignal, images?: string[]): Promise<void> {
    void images;
    this.abortController = new AbortController();
    const forwardAbort = () => void this.cancel();
    if (signal.aborted) forwardAbort();
    else signal.addEventListener('abort', forwardAbort, {once: true});

    let stdoutBuffer = '';
    let emittedCount = 0;
    const emitLine = (line: string) => {
      for (const event of parseClaudeOutput(line)) {
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
        args: ['-p', message, '--output-format', 'json', '--no-session-persistence'],
        cwd: this.cwd,
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
      onEvent({type: 'RuntimeError', message: result.timedOut ? 'Claude execution timed out' : 'Claude execution aborted', at: Date.now()});
      return;
    }
    if (result.exitCode !== 0 && result.stdout.trim().length === 0) {
      for (const event of classifyClaudeFailure(result.stderr, result.exitCode)) onEvent(event);
      return;
    }
    if (emittedCount === 0 && result.stderr.trim().length > 0) {
      for (const event of classifyClaudeFailure(result.stderr, result.exitCode)) onEvent(event);
    }
  }

  async cancel(): Promise<void> {
    this.abortController?.abort();
  }

  async shutdown(): Promise<void> {
    await this.cancel();
  }
}

async function probeVersion(executable: string, cwd: string): Promise<string | undefined> {
  try {
    const result = await runProcess({executable, args: ['--version'], cwd, timeoutMs: 3000});
    return extractVersion(result.stdout.trim() || result.stderr.trim());
  } catch {
    return undefined;
  }
}

function parseAuth(stdout: string): {loggedIn?: boolean} {
  try {
    return JSON.parse(stdout) as {loggedIn?: boolean};
  } catch {
    return {};
  }
}

function extractVersion(output: string): string | undefined {
  return output.match(/([0-9]+(?:\.[0-9]+){1,3})/)?.[1];
}
