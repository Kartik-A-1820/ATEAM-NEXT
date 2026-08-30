import React, {useMemo, useRef, useState} from 'react';
import {Box, useApp, useInput, useWindowSize} from 'ink';
import {RuntimeController} from '../runtime/runtime.js';
import type {SimulationScenario} from '../runtime/simulator.js';
import {initialState, reduce, visibleEntries} from '../domain/state.js';
import type {AgentHealth} from '../domain/agentHealth.js';
import type {AgentId, AppState, TabName} from '../domain/types.js';
import type {AteamEvent, RuntimeCommand} from '../domain/events.js';
import {commandHelp, parseInput} from '../commands/registry.js';
import {InputBox} from './InputBox.js';
import {Header} from './Header.js';
import {StatusBar, TABS} from './StatusBar.js';
import {ConversationView} from './ConversationView.js';
import {AgentsView} from './AgentsView.js';
import {TasksView} from './TasksView.js';
import {ContextView} from './ContextView.js';
import {DiffView} from './DiffView.js';
import {LogsView} from './LogsView.js';
import {EmptyState, shouldShowEmptyState} from './EmptyState.js';
import type {AteamStore, StoredSession} from '../storage/store.js';
import {probeLocalAgents} from '../agents/probe.js';

interface Props {
  simulate: boolean;
  scenario: SimulationScenario;
  store?: AteamStore;
  initial?: AppState;
  sessionMode?: 'new' | 'resume';
  probeProviders?: boolean;
  initialHealth?: Partial<Record<AgentId, AgentHealth>>;
}

export function App({simulate, scenario, store, initial, sessionMode = 'new', probeProviders = false, initialHealth}: Props) {
  const {exit} = useApp();
  const {columns, rows} = useWindowSize();
  const [state, setState] = useState(() => initial ?? initialState(columns, rows));
  const stateRef = useRef(state);
  const statusRef = useRef<StoredSession['status']>('completed');
  stateRef.current = state;

  const send = (event: AteamEvent) => {
    if (event.type === 'RuntimeError') {
      statusRef.current = 'failed';
    }
    if (event.type === 'StopRequested') {
      statusRef.current = 'cancelled';
    }
    store?.appendEvent(stateRef.current.sessionId, event);
    setState(current => reduce(current, event));
  };

  const runtime = useMemo(() => new RuntimeController(send, simulate, scenario, undefined, initialHealth), [simulate, scenario, initialHealth]);

  React.useEffect(() => {
    if (!probeProviders) return undefined;
    let cancelled = false;
    void probeLocalAgents(process.cwd()).then(events => {
      if (cancelled) return;
      for (const event of events) {
        send(event);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [probeProviders]);

  React.useEffect(() => {
    if (sessionMode === 'new') {
      store?.createSession(
        stateRef.current.sessionId,
        simulate ? 'Interactive simulated session' : 'Interactive session',
        stateRef.current.startedAt,
      );
    }
    return () => {
      runtime.shutdown();
      store?.finishSession(stateRef.current.sessionId, statusRef.current, Date.now());
    };
  }, [runtime, sessionMode, simulate, store]);

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
      return;
    }
    if (key.tab) {
      cycleTab(key.shift ? -1 : 1);
      return;
    }
    if (key.ctrl && input === 'l') {
      goToTab('Logs');
    }
  });

  const cycleTab = (direction: 1 | -1) => {
    const index = TABS.indexOf(stateRef.current.activeTab);
    const nextIndex = (index + direction + TABS.length) % TABS.length;
    goToTab(TABS[nextIndex]);
  };

  const goToTab = (tab: TabName) => {
    runtime.handle({kind: 'slashCommand', name: tab.toLowerCase(), args: []});
  };

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

  const conversationHeight = Math.max(6, rows - 12);
  const entries = visibleEntries(state).slice(-Math.max(20, conversationHeight * 2));
  const width = Math.max(40, columns - 4);

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Header state={state} />
      <MainPane state={state} entries={entries} height={conversationHeight} width={width} />
      <StatusBar state={state} />
      <InputBox onSubmit={submit} running={state.running} />
    </Box>
  );
}

function MainPane({state, entries, height, width}: {state: AppState; entries: ReturnType<typeof visibleEntries>; height: number; width: number}) {
  if (state.activeTab === 'Agents') {
    return <AgentsView state={state} height={height} />;
  }
  if (state.activeTab === 'Tasks') {
    return <TasksView state={state} height={height} />;
  }
  if (state.activeTab === 'Logs') {
    return <LogsView log={state.log} width={width} height={height} />;
  }
  if (state.activeTab === 'Context') {
    return <ContextView state={state} height={height} />;
  }
  if (state.activeTab === 'Diff') {
    return <DiffView height={height} />;
  }
  if (shouldShowEmptyState(state)) {
    return <EmptyState state={state} height={height} />;
  }
  return <ConversationView state={state} entries={entries} width={width} height={height} showPlanSummary />;
}
