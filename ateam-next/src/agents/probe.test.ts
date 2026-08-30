import {describe, expect, it} from 'vitest';
import {availabilityFromVersionProbe} from './probe.js';

describe('availabilityFromVersionProbe', () => {
  it('maps successful version probes to ready', () => {
    expect(availabilityFromVersionProbe(0, 'claude 2.1.226')).toBe('READY');
  });

  it('maps auth-looking output to auth error even with zero exit code', () => {
    expect(availabilityFromVersionProbe(0, 'You are not authenticated.')).toBe('AUTH_ERROR');
  });

  it('keeps ambiguous failures unknown', () => {
    expect(availabilityFromVersionProbe(1, 'unexpected failure')).toBe('UNKNOWN');
  });
});
