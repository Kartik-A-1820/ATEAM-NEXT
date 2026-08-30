import type {ExecutableProviderAdapter} from '../domain/events.js';
import type {AgentId} from '../domain/types.js';
import {AgyAdapter} from './agy/adapter.js';
import {ClaudeAdapter} from './claude/adapter.js';
import {CodexAdapter} from './codex/adapter.js';
import {GrokAdapter} from './grok/adapter.js';

export type ProviderMap = Partial<Record<AgentId, ExecutableProviderAdapter>>;

export function createDefaultProviders(cwd = process.cwd()): ProviderMap {
  return {
    codex: new CodexAdapter('codex', cwd),
    claude: new ClaudeAdapter('claude', cwd),
    agy: new AgyAdapter('agy', cwd),
    grok: new GrokAdapter('grok', cwd),
  };
}
