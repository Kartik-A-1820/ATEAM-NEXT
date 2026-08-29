import {describe, expect, it} from 'vitest';
import {commandHelp, parseInput} from './registry.js';

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
