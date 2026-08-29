#!/usr/bin/env node
import React from 'react';
import {Command} from 'commander';
import {render} from 'ink';
import process from 'node:process';
import {App} from './tui/App.js';
import type {SimulationScenario} from './runtime/simulator.js';
import {runHeadlessSimulation} from './runtime/headless.js';
import {AteamStore} from './storage/store.js';
import {formatSessionList, replaySession} from './storage/session.js';
import {formatDoctor, runDoctor} from './doctor/doctor.js';

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
  .option('--scenario <scenario>', 'simulation scenario for --simulate', 'STREAMING')
  .action(async (prompt: string, options: {json?: boolean; simulate?: boolean; scenario?: string}, command: Command) => {
    const localOptions = typeof command.opts === 'function' ? command.opts<{json?: boolean; simulate?: boolean; scenario?: string}>() : options;
    const store = new AteamStore();
    const result = localOptions.simulate
      ? await runHeadlessSimulation(prompt, normalizeScenario(localOptions.scenario ?? 'STREAMING'), store)
      : {
          sessionId: `headless-${Date.now()}`,
          prompt,
          mode: 'provider',
          status: 'not_configured',
          message: 'Production providers are not wired yet; use --simulate or interactive dev mode.',
        };
    if (localOptions.json) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      const message = 'message' in result ? result.message : `Simulated ${result.status}: ${prompt}`;
      process.stdout.write(`${message}\n`);
    }
    store.close();
  });

program.command('doctor')
  .description('inspect local environment and providers')
  .option('--json', 'emit structured JSON')
  .action(async (options: {json?: boolean}) => {
    const report = await runDoctor(process.cwd());
    process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatDoctor(report));
  });

program.command('agents').description('show agent status').option('--json', 'emit structured JSON').action((options: {json?: boolean}) => {
  const agents = ['Codex READY', 'Claude READY', 'AGY READY', 'Grok READY'];
  process.stdout.write(options.json ? `${JSON.stringify({agents})}\n` : `${agents.join('\n')}\n`);
});

program.command('sessions').description('list sessions').option('--json', 'emit structured JSON').action((options: {json?: boolean}) => {
  const store = new AteamStore();
  const sessions = store.listSessions();
  process.stdout.write(options.json ? `${JSON.stringify({sessions}, null, 2)}\n` : formatSessionList(sessions));
  store.close();
});
program.command('resume').description('resume a session').argument('[sessionId]').option('--json', 'emit structured JSON').action((sessionId: string | undefined, options: {json?: boolean}) => {
  const store = new AteamStore();
  const target = sessionId ? store.getSession(sessionId) : store.latestSession();
  if (!target) {
    process.stdout.write(options.json ? `${JSON.stringify({error: 'no sessions'})}\n` : 'No sessions yet.\n');
    store.close();
    return;
  }
  const state = replaySession(store, target.id);
  const payload = {session: target, messages: state?.conversation ?? [], tasks: state?.tasks ?? {}};
  process.stdout.write(options.json ? `${JSON.stringify(payload, null, 2)}\n` : `Resumed ${target.id}: ${target.title}\n${(state?.conversation ?? []).map(item => `${item.speaker}: ${item.text}`).join('\n')}\n`);
  store.close();
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
