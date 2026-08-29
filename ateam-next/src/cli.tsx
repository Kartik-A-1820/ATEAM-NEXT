#!/usr/bin/env node
import React from 'react';
import {Command} from 'commander';
import {render} from 'ink';
import process from 'node:process';
import {App} from './tui/App.js';
import type {SimulationScenario} from './runtime/simulator.js';

const program = new Command();

program
  .name('ateam')
  .description('Unified multi-agent AI engineering terminal.')
  .version('0.1.0')
  .action(() => {
    render(<App simulate={false} scenario="STREAMING" />);
  });

program.command('dev')
  .description('run development modes')
  .option('--simulate', 'run with simulated agents', true)
  .option('--scenario <scenario>', 'FAST|SLOW|STREAMING|TOOL_HEAVY|AUTH_FAILURE|RATE_LIMIT|CRASH|TIMEOUT|PERMISSION_REQUEST|MALFORMED_STREAM', 'STREAMING')
  .action(options => {
    render(<App simulate={Boolean(options.simulate)} scenario={normalizeScenario(options.scenario)} />);
  });

program.command('run')
  .argument('<prompt>')
  .option('--json', 'emit structured JSON')
  .option('--simulate', 'use simulated execution', false)
  .action((prompt: string, options: {json?: boolean; simulate?: boolean}, command: Command) => {
    const localOptions = typeof command.opts === 'function' ? command.opts<{json?: boolean; simulate?: boolean}>() : options;
    const result = {
      sessionId: `headless-${Date.now()}`,
      prompt,
      mode: localOptions.simulate ? 'simulate' : 'provider',
      status: localOptions.simulate ? 'completed' : 'not_configured',
      message: localOptions.simulate ? 'Simulated headless execution completed.' : 'Production providers are not wired yet; use --simulate or interactive dev mode.',
    };
    if (localOptions.json) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      process.stdout.write(`${result.message}\n`);
    }
  });

program.command('doctor')
  .description('inspect local environment and providers')
  .option('--json', 'emit structured JSON')
  .action((options: {json?: boolean}) => {
    const report = {
      terminal: {
        columns: process.stdout.columns ?? null,
        rows: process.stdout.rows ?? null,
        isTTY: process.stdout.isTTY === true,
        stdinTTY: process.stdin.isTTY === true,
      },
      storage: {sqlite: 'planned', writable: true},
      providers: ['codex', 'claude', 'agy', 'grok'].map(name => ({name, availability: 'UNKNOWN', note: 'adapter probes planned for Milestone 3'})),
      git: {detected: true},
    };
    process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatDoctor(report));
  });

program.command('agents').description('show agent status').option('--json', 'emit structured JSON').action((options: {json?: boolean}) => {
  const agents = ['Codex READY', 'Claude READY', 'AGY READY', 'Grok READY'];
  process.stdout.write(options.json ? `${JSON.stringify({agents})}\n` : `${agents.join('\n')}\n`);
});

program.command('sessions').description('list sessions').action(() => {
  process.stdout.write('No persisted sessions yet. Persistence starts in Milestone 4.\n');
});
program.command('resume').description('resume a session').action(() => {
  process.stdout.write('Session resume is planned after SQLite persistence.\n');
});
program.command('config').description('show configuration').action(() => {
  process.stdout.write('Config file support is planned; runtime defaults are active.\n');
});

program.parse();

function normalizeScenario(value: string): SimulationScenario {
  const upper = value.toUpperCase();
  const allowed = new Set(['FAST', 'SLOW', 'STREAMING', 'TOOL_HEAVY', 'AUTH_FAILURE', 'RATE_LIMIT', 'CRASH', 'TIMEOUT', 'PERMISSION_REQUEST', 'MALFORMED_STREAM']);
  return (allowed.has(upper) ? upper : 'STREAMING') as SimulationScenario;
}

function formatDoctor(report: {terminal: Record<string, unknown>; storage: Record<string, unknown>; providers: Array<Record<string, unknown>>; git: Record<string, unknown>}): string {
  return [
    'Ateam doctor',
    `terminal: stdoutTTY=${report.terminal.isTTY} stdinTTY=${report.terminal.stdinTTY} size=${report.terminal.columns ?? '?'}x${report.terminal.rows ?? '?'}`,
    `storage: writable=${report.storage.writable} sqlite=${report.storage.sqlite}`,
    `providers: ${report.providers.map(provider => `${provider.name}:${provider.availability}`).join(' ')}`,
    `git: detected=${report.git.detected}`,
    '',
  ].join('\n');
}
