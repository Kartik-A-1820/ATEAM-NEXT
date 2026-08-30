import {runProcess, streamProcess} from '../../process/runner.js';
import type {AteamEvent, ProviderAdapter} from '../../domain/events.js';
import type {AgentAvailability} from '../../domain/types.js';
import {parseCodexJsonl} from './parser.js';

export class CodexAdapter implements ProviderAdapter {
  readonly id = 'codex' as const;
  private abortController?: AbortController;

  constructor(private readonly executable = 'codex', private readonly cwd = process.cwd()) {}

  async probe(): Promise<{availability: AgentAvailability; version?: string; reason?: string}> {
    try {
      const result = await runProcess({executable: this.executable, args: ['doctor', '--json'], cwd: this.cwd, timeoutMs: 8000});
      const version = extractVersion(result.stdout) ?? extractVersion(result.stderr);
      if (result.exitCode === 0) return {availability: 'READY', version};
      if (result.stdout.toLowerCase().includes('auth') || result.stderr.toLowerCase().includes('auth')) {
        return {availability: 'AUTH_ERROR', version, reason: 'codex doctor reported auth issue'};
      }
      return {availability: 'UNHEALTHY', version, reason: result.stderr.trim() || `doctor exited ${result.exitCode}`};
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
    this.abortController = new AbortController();
    const result = await streamProcess({
      executable: this.executable,
      args: ['exec', '--cd', this.cwd, '--skip-git-repo-check', '--json', '-'],
      cwd: this.cwd,
      stdin: message,
      signal: this.abortController.signal,
    });
    if (result.timedOut || result.aborted) {
      return [{type: 'RuntimeError', message: result.timedOut ? 'Codex execution timed out' : 'Codex execution aborted', at: Date.now()}];
    }
    if (result.exitCode !== 0 && result.stdout.trim().length === 0) {
      return [{type: 'RuntimeError', message: result.stderr.trim() || `Codex exited ${result.exitCode}`, at: Date.now()}];
    }
    return parseCodexJsonl(result.stdout);
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
