import {runProcess, streamProcess, type ProcessResult, type ProcessSpec, type StreamingProcessSpec} from '../../process/runner.js';
import type {AteamEvent, ExecutableProviderAdapter} from '../../domain/events.js';
import type {AgentAvailability} from '../../domain/types.js';
import {parseAgyOutput} from './parser.js';

export interface AgyProcessIo {
  run(spec: ProcessSpec): Promise<ProcessResult>;
  stream(spec: StreamingProcessSpec): Promise<ProcessResult>;
}

const defaultIo: AgyProcessIo = {run: runProcess, stream: streamProcess};

/**
 * AgyAdapter — ProviderAdapter for the AGY / Antigravity CLI.
 *
 * Invocation model: noninteractive, single-shot.
 *   agy -p <prompt> --output-format json
 *
 * Probe:
 *   agy models                 (preferred — lists available models)
 *   agy --version              (fallback if models subcommand unavailable)
 *
 * Auth/quota are NOT fabricated. Any failure during probe is reflected
 * faithfully as NOT_INSTALLED, AUTH_ERROR, or UNHEALTHY.
 */
export class AgyAdapter implements ExecutableProviderAdapter {
  readonly id = 'agy' as const;

  private abortController?: AbortController;

  constructor(
    private readonly executable = 'agy',
    private readonly cwd = process.cwd(),
    private readonly io: AgyProcessIo = defaultIo,
  ) {}

  // -------------------------------------------------------------------------
  // ProviderAdapter — probe
  // -------------------------------------------------------------------------

  async probe(): Promise<{availability: AgentAvailability; version?: string; reason?: string}> {
    // Try `agy models` first — fast, structured, and signals auth state.
    try {
      const models = await this.io.run({
        executable: this.executable,
        args: ['models'],
        cwd: this.cwd,
        timeoutMs: 8000,
      });
      if (!models.timedOut && !models.aborted) {
        return normalizeAgyProbe(models.stdout, models.stderr, models.exitCode ?? -1, 'models');
      }
    } catch {
      // Executable not found or failed to spawn — fall through.
    }

    // Fallback: `agy --version`
    try {
      const version = await this.io.run({
        executable: this.executable,
        args: ['--version'],
        cwd: this.cwd,
        timeoutMs: 5000,
      });
      return normalizeAgyProbe(version.stdout, version.stderr, version.exitCode ?? -1, 'version');
    } catch (error) {
      return {
        availability: 'NOT_INSTALLED',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // -------------------------------------------------------------------------
  // ProviderAdapter — session lifecycle
  // -------------------------------------------------------------------------

  async startSession(send: (event: AteamEvent) => void, signal: AbortSignal): Promise<void> {
    signal.addEventListener('abort', () => void this.cancel(), {once: true});
    send({type: 'AgentAvailabilityChanged', agentId: 'agy', availability: 'READY', at: Date.now()});
  }

  async send(): Promise<void> {
    // Non-interactive adapters implement runOnce; send is a no-op here.
    // Callers that need fire-and-forget can call runOnce and discard events.
  }

  async cancel(): Promise<void> {
    this.abortController?.abort();
  }

  async shutdown(): Promise<void> {
    await this.cancel();
  }

  // -------------------------------------------------------------------------
  // Extended interface — runOnce
  // -------------------------------------------------------------------------

  /**
   * Run a single prompt through AGY's structured JSON path and return
   * the normalized AteamEvents. Thin wrapper around runStreaming so there
   * is a single parsing implementation.
   */
  async runOnce(message: string, images?: string[]): Promise<AteamEvent[]> {
    const events: AteamEvent[] = [];
    await this.runStreaming(message, event => {
      events.push(event);
    }, new AbortController().signal, images);
    return events;
  }

  async runStreaming(message: string, onEvent: (event: AteamEvent) => void, signal: AbortSignal, images?: string[]): Promise<void> {
    this.abortController = new AbortController();
    const onAbort = () => this.abortController?.abort();
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, {once: true});

    let receivedStdoutChunk = false;
    let lineBuffer = '';
    let emitted = false;
    const emit = (event: AteamEvent): void => {
      emitted = true;
      onEvent(event);
    };
    const emitFromRaw = (raw: string): void => {
      for (const event of parseAgyOutput(raw)) {
        emit(event);
      }
    };

    let result: ProcessResult;
    try {
      result = await this.io.stream({
        executable: this.executable,
        args: agyRunOnceArgs(message, images),
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
    } finally {
      signal.removeEventListener('abort', onAbort);
    }

    if (lineBuffer.trim().length > 0) {
      emitFromRaw(lineBuffer);
    }

    if (result.timedOut) {
      onEvent({type: 'RuntimeError', message: 'AGY execution timed out', at: Date.now()});
      return;
    }
    if (result.aborted) {
      onEvent({type: 'RuntimeError', message: 'AGY execution aborted', at: Date.now()});
      return;
    }

    // Non-zero exit with empty stdout is a hard failure (spawn error, missing
    // auth token written to stderr, etc.).
    if (result.exitCode !== 0 && result.stdout.trim().length === 0) {
      for (const event of normalizeExitFailure(result.stderr, result.exitCode)) {
        onEvent(event);
      }
      return;
    }

    if (!receivedStdoutChunk) {
      for (const event of parseAgyOutput(result.stdout)) {
        emit(event);
      }
    }

    // If stdout was empty but we still got something on stderr, surface it.
    if (!emitted && result.stderr.trim().length > 0) {
      for (const event of normalizeExitFailure(result.stderr, result.exitCode)) {
        onEvent(event);
      }
    }
  }
}

/** `agy --help` has no image-attachment flag on `-p`/`--print`. Images are ignored. */
export function agyRunOnceArgs(prompt: string, images?: string[]): string[] {
  void images;
  return ['-p', prompt, '--output-format', 'json'];
}

// ---------------------------------------------------------------------------
// Probe normalization
// ---------------------------------------------------------------------------

export function normalizeAgyProbe(
  stdout: string,
  stderr: string,
  exitCode: number,
  via: 'models' | 'version',
): {availability: AgentAvailability; version?: string; reason?: string} {
  const version = extractVersion(stdout) ?? extractVersion(stderr);
  const plain = `${stdout}\n${stderr}`.toLowerCase();

  if (exitCode === 0) {
    // For `agy models` an empty model list (just `[]`) is still OK — the
    // CLI is reachable and the user is authenticated.
    return {availability: 'READY', version};
  }

  // Auth / credentials problems.
  if (
    plain.includes('not authenticated') ||
    plain.includes('login required') ||
    plain.includes('auth failed') ||
    plain.includes('unauthorized') ||
    plain.includes('sign in') ||
    plain.includes('403') ||
    plain.includes('credential')
  ) {
    return {availability: 'AUTH_ERROR', version, reason: `agy ${via} reported auth issue`};
  }

  // Rate limit (unusual at probe time but possible).
  if (plain.includes('rate limit') || plain.includes('429') || plain.includes('quota')) {
    return {availability: 'RATE_LIMITED', version, reason: 'agy rate-limited during probe'};
  }

  // Executable found but unhealthy for another reason.
  const detail = stderr.trim() || stdout.trim() || `agy ${via} exited ${exitCode}`;
  return {availability: 'UNHEALTHY', version, reason: detail};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractVersion(output: string): string | undefined {
  // Matches patterns like "agy 1.2.3", "antigravity 0.9.1", or {"version":"1.2.3"}
  const match =
    output.match(/"version"\s*:\s*"([^"]+)"/) ??
    output.match(/agy(?:\/antigravity)?\s+([0-9][0-9a-zA-Z._-]*)/) ??
    output.match(/antigravity\s+([0-9][0-9a-zA-Z._-]*)/i) ??
    output.match(/\bv([0-9]+\.[0-9]+\.[0-9][0-9a-zA-Z._-]*)\b/);
  return match?.[1];
}

function normalizeExitFailure(stderr: string, exitCode: number | null): AteamEvent[] {
  const lower = stderr.toLowerCase();
  const at = Date.now();

  if (
    lower.includes('auth') ||
    lower.includes('login') ||
    lower.includes('sign') ||
    lower.includes('unauthorized') ||
    lower.includes('credential') ||
    lower.includes('403')
  ) {
    return [{type: 'AgentAvailabilityChanged', agentId: 'agy', availability: 'AUTH_ERROR', reason: stderr.trim(), at}];
  }

  if (lower.includes('rate limit') || lower.includes('429') || lower.includes('quota') || lower.includes('too many request')) {
    return [{type: 'RateLimited', agentId: 'agy', at}];
  }

  const message = stderr.trim() || `AGY exited with code ${exitCode ?? 'null'}`;
  return [{type: 'RuntimeError', message, at}];
}
