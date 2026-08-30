import {describe, expect, it} from 'vitest';
import {commandHelp, completeSlashInput, parseInput, slashAutocomplete} from './registry.js';

describe('slash command registry', () => {
  it('parses user messages separately from slash commands', () => {
    expect(parseInput('fix auth')).toEqual({kind: 'submitUserMessage', message: 'fix auth'});
    expect(parseInput('/verbosity trace')).toEqual({kind: 'setVerbosity', verbosity: 'TRACE'});
    expect(parseInput('/permissions full')).toEqual({kind: 'setPermissionMode', mode: 'FULL'});
  });

  it('provides registered help', () => {
    expect(commandHelp()).toContain('/agents');
    expect(commandHelp('stop')).toContain('/stop');
  });
});

describe('slashAutocomplete', () => {
  it('returns command names matching a typed prefix, case-insensitively', () => {
    expect(slashAutocomplete('/sta').suggestions).toEqual(['status']);
    expect(slashAutocomplete('/STA').suggestions).toEqual(['status']);
    expect(slashAutocomplete('/s').suggestions).toEqual(['status', 'stop']);
  });

  it('caps command matches so a bare slash cannot flood a small terminal', () => {
    const result = slashAutocomplete('/');
    expect(result.kind).toBe('commands');
    expect(result.suggestions).toHaveLength(5);
    expect(result.suggestions).toEqual(['help', 'agents', 'status', 'plan', 'tasks']);
  });

  it('does not suggest commands once a space has been typed', () => {
    expect(slashAutocomplete('/stop ').kind).toBe('none');
    expect(slashAutocomplete('/stop all').suggestions).toEqual([]);
  });

  it('suggests the four agent ids after an agent: fragment at the end of the input', () => {
    expect(slashAutocomplete('/stop agent:').suggestions).toEqual(['codex', 'claude', 'agy', 'grok']);
    expect(slashAutocomplete('/stop agent:cl').suggestions).toEqual(['claude']);
    expect(slashAutocomplete('/stop agent:C').suggestions).toEqual(['codex', 'claude']);
  });

  it('ignores agent: when it is not at the end of the input', () => {
    expect(slashAutocomplete('/stop agent:claude extra').suggestions).toEqual([]);
  });

  it('returns nothing for ordinary prose', () => {
    expect(slashAutocomplete('fix auth')).toEqual({kind: 'none', suggestions: []});
  });
});

describe('completeSlashInput', () => {
  it('completes a unique command prefix to the full name plus a trailing space', () => {
    expect(completeSlashInput('/sta')).toBe('/status ');
    expect(completeSlashInput('/status')).toBe('/status ');
  });

  it('does not complete an ambiguous command prefix', () => {
    expect(completeSlashInput('/s')).toBeUndefined();
    expect(completeSlashInput('/')).toBeUndefined();
  });

  it('completes a unique agent: prefix', () => {
    expect(completeSlashInput('/stop agent:cl')).toBe('/stop agent:claude ');
  });

  it('does not complete an ambiguous agent: prefix', () => {
    expect(completeSlashInput('/stop agent:')).toBeUndefined();
    expect(completeSlashInput('/stop agent:c')).toBeUndefined();
  });
});
