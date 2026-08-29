import process from 'node:process';
import {accessSync, constants} from 'node:fs';
import {dirname} from 'node:path';
import {defaultStorePath} from '../storage/store.js';
import {runProcess} from '../process/runner.js';

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'warning' | 'fail' | 'unknown';
  summary: string;
  details?: Record<string, unknown>;
}

export interface DoctorReport {
  terminal: DoctorCheck;
  storage: DoctorCheck;
  git: DoctorCheck;
  providers: DoctorCheck[];
}

export async function runDoctor(cwd = process.cwd()): Promise<DoctorReport> {
  const [git, ...providers] = await Promise.all([
    probeGit(cwd),
    probeCommand('codex', ['--version'], cwd),
    probeCommand('claude', ['--version'], cwd),
    probeCommand('agy', ['--version'], cwd),
    probeCommand('grok', ['--version'], cwd),
  ]);

  return {
    terminal: {
      name: 'terminal',
      status: process.stdout.isTTY && process.stdin.isTTY ? 'ok' : 'warning',
      summary: `stdoutTTY=${process.stdout.isTTY === true} stdinTTY=${process.stdin.isTTY === true}`,
      details: {columns: process.stdout.columns ?? null, rows: process.stdout.rows ?? null, platform: process.platform},
    },
    storage: probeStorage(),
    git,
    providers,
  };
}

export function formatDoctor(report: DoctorReport): string {
  const rows = [report.terminal, report.storage, report.git, ...report.providers];
  return `Ateam doctor\n${rows.map(row => `${row.status.toUpperCase()}\t${row.name}\t${row.summary}`).join('\n')}\n`;
}

async function probeGit(cwd: string): Promise<DoctorCheck> {
  try {
    const result = await runProcess({executable: 'git', args: ['rev-parse', '--show-toplevel'], cwd, timeoutMs: 2000});
    return {
      name: 'git',
      status: result.exitCode === 0 ? 'ok' : 'warning',
      summary: result.exitCode === 0 ? result.stdout.trim() : result.stderr.trim() || 'not a git repository',
    };
  } catch (error) {
    return {name: 'git', status: 'fail', summary: error instanceof Error ? error.message : String(error)};
  }
}

async function probeCommand(name: string, args: string[], cwd: string): Promise<DoctorCheck> {
  try {
    const result = await runProcess({executable: name, args, cwd, timeoutMs: 4000});
    const output = result.stdout.trim() || result.stderr.trim();
    return {
      name,
      status: result.exitCode === 0 ? 'ok' : 'warning',
      summary: output.split(/\r?\n/)[0] || `exit ${result.exitCode}`,
    };
  } catch (error) {
    return {name, status: 'unknown', summary: error instanceof Error ? error.message : String(error)};
  }
}

function probeStorage(): DoctorCheck {
  const path = defaultStorePath();
  try {
    accessSync(dirname(path), constants.W_OK);
    return {name: 'storage', status: 'ok', summary: path};
  } catch {
    return {name: 'storage', status: 'warning', summary: `${dirname(path)} will be created on first write`, details: {path}};
  }
}
