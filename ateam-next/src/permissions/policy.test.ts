import {describe, expect, it} from 'vitest';
import {PermissionPolicy} from './policy.js';

describe('PermissionPolicy', () => {
  it('applies profile defaults and explicit denials', () => {
    const policy = new PermissionPolicy('STANDARD');
    expect(policy.decide('write_project')).toBe('ALLOW');
    expect(policy.decide('git_push')).toBe('ASK');
    policy.deny('write_project');
    expect(policy.decide('write_project')).toBe('DENY');
  });
});
