import {describe, expect, it} from 'vitest';
import {normalizeCodexDoctor} from './adapter.js';

describe('normalizeCodexDoctor', () => {
  it('keeps auth-ready Codex ready when only terminal doctor checks fail', () => {
    const stdout = JSON.stringify({
      overallStatus: 'fail',
      codexVersion: '0.151.0',
      checks: {
        'auth.credentials': {status: 'ok', summary: 'auth is configured'},
        'terminal.env': {status: 'fail', summary: 'TERM=dumb - colors and cursor control are disabled'},
      },
    });

    expect(normalizeCodexDoctor(stdout, '', 1)).toEqual({
      availability: 'READY',
      version: '0.151.0',
      reason: 'TERM=dumb - colors and cursor control are disabled',
    });
  });

  it('does not let non-blocking warnings mask terminal-only failures', () => {
    const stdout = JSON.stringify({
      overallStatus: 'fail',
      codexVersion: '0.151.0',
      checks: {
        'auth.credentials': {status: 'ok', summary: 'auth is configured'},
        'git.worktree.dev_drive': {status: 'warning', summary: 'not on a Windows Dev Drive'},
        'terminal.env': {status: 'fail', summary: 'TERM=dumb - colors and cursor control are disabled'},
      },
    });

    expect(normalizeCodexDoctor(stdout, '', 1)).toEqual({
      availability: 'READY',
      version: '0.151.0',
      reason: 'not on a Windows Dev Drive',
    });
  });


  it('treats non-terminal failed doctor checks as unhealthy', () => {
    const stdout = JSON.stringify({
      overallStatus: 'fail',
      codexVersion: '0.151.0',
      checks: {
        'auth.credentials': {status: 'ok', summary: 'auth is configured'},
        'network.provider_reachability': {status: 'fail', summary: 'provider endpoints unreachable'},
      },
    });

    expect(normalizeCodexDoctor(stdout, '', 1)).toEqual({
      availability: 'UNHEALTHY',
      version: '0.151.0',
      reason: 'provider endpoints unreachable',
    });
  });

  it('reports auth error only when the auth check fails', () => {
    const stdout = JSON.stringify({
      overallStatus: 'fail',
      codexVersion: '0.151.0',
      checks: {
        'auth.credentials': {status: 'fail', summary: 'auth is not configured'},
      },
    });

    expect(normalizeCodexDoctor(stdout, '', 1)).toMatchObject({
      availability: 'AUTH_ERROR',
      version: '0.151.0',
    });
  });

  it('falls back to plain text auth detection when JSON is unavailable', () => {
    expect(normalizeCodexDoctor('', 'not authenticated', 1)).toMatchObject({availability: 'AUTH_ERROR'});
  });
});
