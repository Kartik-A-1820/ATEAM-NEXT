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

  React.useEffect(() => {
    if (process.stdout.isTTY !== true) return undefined;
    const cleanup = () => {
      process.stdout.write('\x1b[?25h\x1b[0m\n');
    };
    process.once('exit', cleanup);
    return () => {
      process.off('exit', cleanup);
      cleanup();
    };
  }, []);

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

  const conversationHeight = Math.max(6, rows - 10);
  const entries = visibleEntries(state).slice(-conversationHeight);
  const width = Math.max(40, columns - 4);

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Header state={state} />
      <MainPane state={state} entries={entries} height={conversationHeight} width={width} />
      <Footer activeTab={state.activeTab} />
      <InputBox onSubmit={submit} />
    </Box>
  );
}

function MainPane({state, entries, height, width}: {state: ReturnType<typeof initialState>; entries: ReturnType<typeof visibleEntries>; height: number; width: number}) {
  if (state.activeTab === 'Agents') {
    return (
      <Box flexDirection="column" height={height} paddingX={1}>
        {Object.values(state.agents).map(agent => (
          <Text key={agent.id} color={agent.color}>
            {statusSymbol[agent.availability] ?? 'o'} {agent.displayName} {agent.availability} tasks={agent.runningTaskCount} auth={String(agent.authenticated)}
            {agent.lastError ? ` error=${agent.lastError}` : ''}
          </Text>
        ))}
      </Box>
    );
  }
  if (state.activeTab === 'Tasks') {
    const tasks = Object.values(state.tasks);
    return (
      <Box flexDirection="column" height={height} paddingX={1}>
        {tasks.length === 0 ? <Text>No tasks yet.</Text> : tasks.map(task => (
          <Text key={task.id}>{task.id} {task.status} {task.assignedAgent ?? 'unassigned'} deps={task.dependencies.join(',') || '-'} - {task.objective}</Text>
        ))}
      </Box>
    );
  }
  if (state.activeTab === 'Logs') {
    return (
      <Box flexDirection="column" height={height} paddingX={1}>
        {state.log.slice(-Math.max(1, Math.floor(height / 2))).map((line, index) => <Text key={`${index}-${line}`}>{wrapAnsi(line, width, {hard: true})}</Text>)}
      </Box>
    );
  }
  if (state.activeTab === 'Context') {
    return (
      <Box flexDirection="column" height={height} paddingX={1}>
        <Text>Canonical context packets and provenance-aware memory are planned for Milestone 4.</Text>
        <Text>Latest user instruction always supersedes the active plan.</Text>
      </Box>
    );
  }
  if (state.activeTab === 'Diff') {
    return (
      <Box flexDirection="column" height={height} paddingX={1}>
        <Text>Workspace diff inspection is planned for provider/workspace integration.</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" height={height} paddingX={1}>
      {conversationLines(entries, width, height).map(line => (
        <Text key={line.key} color={line.color}>{line.text}</Text>
      ))}
    </Box>
  );
}

function conversationLines(entries: ReturnType<typeof visibleEntries>, width: number, maxLines: number): Array<{key: string; text: string; color: ReturnType<typeof speakerColor>}> {
  const lines: Array<{key: string; text: string; color: ReturnType<typeof speakerColor>}> = [];
  for (const item of entries) {
    const prefix = `${item.speaker}: `;
    const wrapped = wrapAnsi(`${prefix}${item.text}`, width, {hard: true}).split('\n');
    wrapped.forEach((text, index) => {
      lines.push({key: `${item.id}-${index}`, text, color: index === 0 ? speakerColor(item.speaker) : 'white'});
    });
  }
  return lines.slice(-maxLines);
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

function Footer({activeTab}: {activeTab: string}) {
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text>{['Plan', 'Agents', 'Tasks', 'Diff', 'Context', 'Logs'].map(tab => tab === activeTab ? `[${tab}]` : tab).join(' | ')}  /help /stop /quit</Text>
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
