import React, {useMemo, useRef, useState} from 'react';
import {Box, Text, useApp, useInput, useWindowSize} from 'ink';
import wrapAnsi from 'wrap-ansi';
import {RuntimeController} from '../runtime/runtime.js';
import type {SimulationScenario} from '../runtime/simulator.js';
import {initialState, reduce, visibleEntries} from '../domain/state.js';
import type {AteamEvent, RuntimeCommand} from '../domain/events.js';
import {commandHelp, parseInput} from '../commands/registry.js';
import {InputBox} from './InputBox.js';

interface Props {
  simulate: boolean;
  scenario: SimulationScenario;
}

const statusSymbol: Record<string, string> = {
  READY: '*',
  BUSY: '~',
  IDLE: 'o',
  RATE_LIMITED: 'o',
  AUTH_ERROR: '!',
  UNHEALTHY: '!',
};

export function App({simulate, scenario}: Props) {
  const {exit} = useApp();
  const {columns, rows} = useWindowSize();
  const [state, setState] = useState(() => initialState(columns, rows));
  const stateRef = useRef(state);
  stateRef.current = state;

  const send = (event: AteamEvent) => {
    setState(current => reduce(current, event));
  };

  const runtime = useMemo(() => new RuntimeController(send, simulate, scenario), [simulate, scenario]);

  React.useEffect(() => {
    send({type: 'TerminalResized', width: columns, height: rows, at: Date.now()});
  }, [columns, rows]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      runtime.handle({kind: 'stop', scope: 'all'});
      exit();
    }
  });

  const submit = (value: string) => {
    const parsed = parseInput(value);
    if (parsed.kind === 'help') {
      send({type: 'PlanUpdated', summary: commandHelp(parsed.topic), at: Date.now()});
      return;
    }
    if (parsed.kind === 'quit') {
      runtime.handle(parsed);
      exit();
      return;
    }
    runtime.handle(parsed as RuntimeCommand);
  };

  const conversationHeight = Math.max(6, rows - 9);
  const entries = visibleEntries(state).slice(-conversationHeight);
  const width = Math.max(40, columns - 4);

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Header state={state} />
      <Box flexDirection="column" height={conversationHeight} paddingX={1}>
        {entries.map(item => (
          <Text key={item.id}>
            <Text color={speakerColor(item.speaker)}>{item.speaker}: </Text>
            {wrapAnsi(item.text, width, {hard: true}).split('\n').join('\n')}
          </Text>
        ))}
      </Box>
      <Tabs />
      <InputBox onSubmit={submit} />
    </Box>
  );
}

function Header({state}: {state: ReturnType<typeof initialState>}) {
  const ready = Object.values(state.agents).filter(agent => agent.availability === 'READY').length;
  const total = Object.values(state.agents).length;
  const agentSummary = Object.values(state.agents)
    .map(agent => `${statusSymbol[agent.availability] ?? 'o'} ${agent.displayName} ${agent.availability}`)
    .join('  ');

  return (
    <Box borderStyle="single" paddingX={1}>
      <Text>ATEAM  {ready}/{total} agents ready | {state.permissionMode} | {state.verbosity}  {agentSummary}</Text>
    </Box>
  );
}

function Tabs() {
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text>Plan | Agents | Tasks | Diff | Context | Logs</Text>
    </Box>
  );
}

function speakerColor(speaker: string): 'green' | 'yellow' | 'cyan' | 'magenta' | 'white' {
  if (speaker === 'codex') return 'green';
  if (speaker === 'claude') return 'yellow';
  if (speaker === 'agy') return 'cyan';
  if (speaker === 'grok') return 'magenta';
  return 'white';
}
