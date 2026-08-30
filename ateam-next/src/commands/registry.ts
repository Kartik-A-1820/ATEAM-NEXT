import type {RuntimeCommand, Verbosity} from '../domain/events.js';
import type {PermissionMode} from '../domain/types.js';

export interface SlashCommandSpec {
  name: string;
  usage: string;
  description: string;
  parse(args: string[]): RuntimeCommand | {kind: 'help'; topic?: string};
}

const verbosityValues = new Set(['quiet', 'normal', 'verbose', 'trace']);
const permissionValues = new Set(['safe', 'standard', 'full']);

export const registry: SlashCommandSpec[] = [
  {name: 'help', usage: '/help [command]', description: 'Show available commands.', parse: args => ({kind: 'help', topic: args[0]})},
  {name: 'agents', usage: '/agents', description: 'Show provider status.', parse: args => ({kind: 'slashCommand', name: 'agents', args})},
  {name: 'status', usage: '/status', description: 'Show runtime status.', parse: args => ({kind: 'slashCommand', name: 'status', args})},
  {name: 'plan', usage: '/plan', description: 'Switch to plan view.', parse: args => ({kind: 'slashCommand', name: 'plan', args})},
  {name: 'tasks', usage: '/tasks', description: 'Switch to tasks view.', parse: args => ({kind: 'slashCommand', name: 'tasks', args})},
  {name: 'permissions', usage: '/permissions <safe|standard|full>', description: 'Set permission mode.', parse: args => ({kind: 'setPermissionMode', mode: normalizePermission(args[0])})},
  {name: 'verbosity', usage: '/verbosity <quiet|normal|verbose|trace>', description: 'Set output detail.', parse: args => ({kind: 'setVerbosity', verbosity: normalizeVerbosity(args[0])})},
  {name: 'context', usage: '/context', description: 'Inspect current context.', parse: args => ({kind: 'slashCommand', name: 'context', args})},
  {name: 'memory', usage: '/memory', description: 'Inspect provenance-aware memory.', parse: args => ({kind: 'slashCommand', name: 'memory', args})},
  {name: 'diff', usage: '/diff', description: 'Inspect workspace changes.', parse: args => ({kind: 'slashCommand', name: 'diff', args})},
  {name: 'logs', usage: '/logs', description: 'Switch to logs view.', parse: args => ({kind: 'slashCommand', name: 'logs', args})},
  {name: 'usage', usage: '/usage', description: 'Show usage and quota state.', parse: args => ({kind: 'slashCommand', name: 'usage', args})},
  {name: 'doctor', usage: '/doctor', description: 'Run diagnostics.', parse: args => ({kind: 'slashCommand', name: 'doctor', args})},
  {name: 'graph', usage: '/graph', description: 'Show knowledge graph stats.', parse: args => ({kind: 'slashCommand', name: 'graph', args})},
  {name: 'reindex', usage: '/reindex', description: 'Rebuild the local knowledge graph.', parse: args => ({kind: 'slashCommand', name: 'reindex', args})},
  {name: 'stop', usage: '/stop [all|task:T7|agent:claude]', description: 'Cancel activity.', parse: args => ({kind: 'stop', scope: args[0] ?? 'current'})},
  {name: 'resume', usage: '/resume', description: 'Resume activity.', parse: args => ({kind: 'slashCommand', name: 'resume', args})},
  {name: 'clear', usage: '/clear', description: 'Clear the visible conversation.', parse: args => ({kind: 'slashCommand', name: 'clear', args})},
  {name: 'quit', usage: '/quit', description: 'Exit Ateam.', parse: () => ({kind: 'quit'})},
];

export const AUTOCOMPLETE_LIMIT = 5;
export const AUTOCOMPLETE_AGENT_IDS = ['codex', 'claude', 'agy', 'grok'] as const;

export type SlashAutocompleteKind = 'commands' | 'agents' | 'none';

export interface SlashAutocomplete {
  kind: SlashAutocompleteKind;
  suggestions: string[];
}

/** Pure slash-command / agent-id hinting for the input box. No runtime I/O. */
export function slashAutocomplete(input: string, limit = AUTOCOMPLETE_LIMIT): SlashAutocomplete {
  if (!input.startsWith('/')) {
    return {kind: 'none', suggestions: []};
  }

  const agentMatch = /agent:([^\s]*)$/i.exec(input);
  if (agentMatch) {
    const typed = agentMatch[1].toLowerCase();
    const suggestions = AUTOCOMPLETE_AGENT_IDS.filter(id => id.startsWith(typed));
    return {kind: 'agents', suggestions: [...suggestions]};
  }

  if (/\s/.test(input)) {
    return {kind: 'none', suggestions: []};
  }

  const prefix = input.slice(1).toLowerCase();
  const suggestions = registry
    .filter(command => command.name.toLowerCase().startsWith(prefix))
    .map(command => command.name)
    .slice(0, limit);
  return {kind: suggestions.length > 0 ? 'commands' : 'none', suggestions};
}

/** Tab-complete a unique command name or unique agent: prefix. Undefined if not unique. */
export function completeSlashInput(input: string): string | undefined {
  const result = slashAutocomplete(input);
  if (result.suggestions.length !== 1) return undefined;
  if (result.kind === 'commands') {
    return `/${result.suggestions[0]} `;
  }
  if (result.kind === 'agents') {
    return input.replace(/agent:[^\s]*$/i, `agent:${result.suggestions[0]} `);
  }
  return undefined;
}

export function parseInput(input: string): RuntimeCommand | {kind: 'help'; topic?: string} {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return {kind: 'submitUserMessage', message: input};
  }
  const [nameWithSlash, ...args] = trimmed.split(/\s+/);
  const name = nameWithSlash.slice(1).toLowerCase();
  const spec = registry.find(command => command.name === name);
  if (!spec) {
    return {kind: 'slashCommand', name: 'unknown', args: [name, ...args]};
  }
  return spec.parse(args);
}

export function commandHelp(topic?: string): string {
  const commands = topic ? registry.filter(item => item.name === topic.replace(/^\//, '')) : registry;
  if (commands.length === 0) {
    return `Unknown command ${topic}. Try /help.`;
  }
  return commands.map(item => `${item.usage} - ${item.description}`).join('\n');
}

function normalizeVerbosity(value?: string): Verbosity {
  const raw = (value ?? 'normal').toLowerCase();
  if (!verbosityValues.has(raw)) {
    return 'NORMAL';
  }
  return raw.toUpperCase() as Verbosity;
}

function normalizePermission(value?: string): PermissionMode {
  const raw = (value ?? 'standard').toLowerCase();
  if (!permissionValues.has(raw)) {
    return 'STANDARD';
  }
  return raw.toUpperCase() as PermissionMode;
}
