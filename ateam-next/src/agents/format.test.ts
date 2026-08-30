import {describe, expect, it} from 'vitest';
import {formatAgentEvents} from './format.js';

describe('formatAgentEvents', () => {
  it('formats canonical agent availability events', () => {
    expect(formatAgentEvents([
      {type: 'AgentAvailabilityChanged', agentId: 'codex', availability: 'READY', version: '0.151.0', at: 1},
      {type: 'AgentAvailabilityChanged', agentId: 'grok', availability: 'AUTH_ERROR', reason: 'not authenticated', at: 1},
    ])).toBe('codex\tREADY\t0.151.0\ngrok\tAUTH_ERROR\t-\tnot authenticated\n');
  });
});
