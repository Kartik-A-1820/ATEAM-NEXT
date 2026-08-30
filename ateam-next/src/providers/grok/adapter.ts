import {runProcess, streamProcess, type ProcessResult, type ProcessSpec, type StreamingProcessSpec} from '../../process/runner.js';
import type {AteamEvent, ExecutableProviderAdapter} from '../../domain/events.js';
import type {AgentAvailability} from '../../domain/types.js';
import {classifyGrokPlainFailure, looksLikeAuthFailure, looksLikeRateLimit, parseGrokOutput} from './parser.js';

export interface GrokProcessIo {
  run(spec: ProcessSpec): Promise<ProcessResult>;
  stream(spec: StreamingProcessSpec): Promise<ProcessResult>;
}

export interface GrokProbeResult {
  availability: AgentAvailability;
  version?: string;
  reason?: string;
}

export const grokProbeAttempts = [
  {args: ['inspect', '--json'], timeoutMs: 8000},
  {args: ['models'], timeoutMs: 8000},
  {args: ['--version'], timeoutMs: 4000},
] as const;

const defaultIo: GrokProcessIo = {run: runProcess, stream: streamProcess};

export class GrokAdapter implements ExecutableProviderAdapter {
  readonly id = 'grok' as const;
  private abortController?: AbortController;

  constructor(
    private readonly executable = 'grok',
    private readonly cwd = process.cwd(),
    private readonly io: GrokProcessIo = defaultIo,
  ) {}

  async probe(): Promise<GrokProbeResult> {
    let last: GrokProbeResult | undefined;
    for (const attempt of grokProbeAttempts) {
      let result: ProcessResult;
      try {
        result = await this.io.run({
          executable: this.executable,
          args: [...attempt.args],
          cwd: this.cwd,
          timeoutMs: attempt.timeoutMs,
        });
      } catch (error) {
        if (!last) {
          return {availability: 'NOT_INSTALLED', reason: error instanceof Error ? error.message : String(error)};
        }
        break;
      }
      last = normalizeGrokProbe(result.stdout, result.stderr, result.exitCode ?? -1);
      if (isConclusiveProbe(last)) return last;
    }
    return last ?? {availability: 'UNKNOWN', reason: 'Grok probe produced no output'};
  }

  async startSession(send: (event: AteamEvent) => void, signal: AbortSignal): Promise<void> {
    signal.addEventListener('abort', () => void this.cancel(), {once: true});
    send({type: 'AgentAvailabilityChanged', agentId: 'grok', availability: 'READY', at: Date.now()});
  }

  async send(message: string): Promise<void> {
    this.abortController = new AbortController();
    await this.io.run({
      executable: this.executable,
      args: grokRunOnceArgs(message, this.cwd),
      cwd: this.cwd,
      signal: this.abortController.signal,
    });
  }

  async runOnce(message: string, images?: string[]): Promise<AteamEvent[]> {
    const events: AteamEvent[] = [];
    await this.runStreaming(message, event => {
      events.push(event);
    }, new AbortController().signal, images);
    return events;
  }

  async runStreaming(message: string, onEvent: (event: AteamEvent) => void, signal: AbortSignal, images?: string[]): Promise<void> {
    this.abortController = new AbortController();
    const at = Date.now();
    const onAbort = () => this.abortController?.abort();
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, {once: true});

    let receivedStdoutChunk = false;
    let lineBuffer = '';
    const emitFromRaw = (raw: string): void => {
      for (const event of parseGrokOutput(raw, {at})) {
        onEvent(event);
      }
    };

    let result: ProcessResult;
    try {
      result = await this.io.stream({
        executable: this.executable,
        args: grokRunOnceArgs(message, this.cwd, images),
        cwd: this.cwd,
        signal: this.abortController.signal,
        onStdout: chunk => {
          receivedStdoutChunk = true;
          lineBuffer += chunk;
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() ?? '';
          for (const line of lines) {
            if (line.trim().length === 0) continue;
            emitFromRaw(line);
          }
        },
      });
    } catch (error) {
      onEvent({type: 'RuntimeError', message: error instanceof Error ? error.message : String(error), at});
      return;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }

    if (lineBuffer.trim().length > 0) {
      emitFromRaw(lineBuffer);
    }

    if (result.timedOut) {
      onEvent({type: 'RuntimeError', message: 'Grok execution timed out', at});
      return;
    }
    if (result.aborted) {
      onEvent({type: 'RuntimeError', message: 'Grok execution aborted', at});
      return;
    }
    if (result.stdout.trim().length === 0) {
      for (const event of classifyGrokPlainFailure(result.stderr, result.exitCode ?? -1, at)) {
        onEvent(event);
      }
    } else if (!receivedStdoutChunk) {
      emitFromRaw(result.stdout);
    }
  }

  async cancel(): Promise<void> {
    this.abortController?.abort();
  }

  async shutdown(): Promise<void> {
    await this.cancel();
  }
}

/** `grok --help` has no image-attachment flag on `-p`/`--single`. Images are ignored. */
export function grokRunOnceArgs(prompt: string, cwd: string, images?: string[]): string[] {
  void images;
  return ['-p', prompt, '--cwd', cwd, '--output-format', 'json'];
}

export function normalizeGrokProbe(stdout: string, stderr: string, exitCode: number): GrokProbeResult {
  const version = extractGrokVersion(stdout) ?? extractGrokVersion(stderr);
  const parsed = parseJsonObject(stdout);
  const inspectShaped = isInspectPayload(parsed);
  const jsonFailure = jsonFailureText(parsed);
  const failureText = inspectShaped ? stderr : [jsonFailure, stdout, stderr].filter(Boolean).join('\n');

  if (looksLikeAuthFailure(failureText) || looksLikeAuthFailure(jsonFailure)) {
    return {availability: 'AUTH_ERROR', version, reason: firstLine(failureText) || 'Grok reported an auth issue'};
  }
  if (looksLikeRateLimit(failureText) || looksLikeRateLimit(jsonFailure)) {
    return {availability: 'RATE_LIMITED', version, reason: firstLine(failureText) || 'Grok reported a rate limit'};
  }
  if (inspectShaped && version) {
    return {availability: 'READY', version};
  }
  if (exitCode === 0) {
    return {availability: 'READY', version};
  }
  return {availability: 'UNKNOWN', version, reason: firstLine(stderr) || firstLine(stdout) || `Grok probe exited ${exitCode}`};
}

function isConclusiveProbe(result: GrokProbeResult): boolean {
  return result.availability === 'READY'
    || result.availability === 'AUTH_ERROR'
    || result.availability === 'RATE_LIMITED'
    || result.availability === 'SIGNED_OUT';
}

function extractGrokVersion(output: string): string | undefined {
  const jsonMatch = output.match(/"grokVersion"\s*:\s*"([^"]+)"/);
  if (jsonMatch?.[1]) return jsonMatch[1];
  const cliMatch = output.match(/\bgrok\s+([0-9]+(?:\.[0-9]+){1,3})\b/i);
  return cliMatch?.[1];
}

function parseJsonObject(stdout: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout.trim());
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function isInspectPayload(parsed: Record<string, unknown> | undefined): boolean {
  if (!parsed) return false;
  return 'grokVersion' in parsed || 'loginPolicy' in parsed || 'projectRoot' in parsed;
}

function jsonFailureText(parsed: Record<string, unknown> | undefined): string {
  if (!parsed) return '';
  if (typeof parsed.error === 'string') return parsed.error;
  if (parsed.error && typeof parsed.error === 'object' && !Array.isArray(parsed.error) && typeof (parsed.error as {message?: unknown}).message === 'string') {
    return String((parsed.error as {message: string}).message);
  }
  if (typeof parsed.message === 'string' && (parsed.type === 'error' || parsed.error !== undefined)) {
    return parsed.message;
  }
  return '';
}

function firstLine(text: string): string | undefined {
  const line = text.split(/\r?\n/).map(value => value.trim()).find(Boolean);
  return line;
}
