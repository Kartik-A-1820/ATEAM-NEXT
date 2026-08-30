import React from 'react';
import {Box, Text} from 'ink';
import type {AppState, TabName} from '../domain/types.js';

const TABS: TabName[] = ['Plan', 'Agents', 'Tasks', 'Diff', 'Context', 'Logs'];

interface Props {
  state: AppState;
}

export function StatusBar({state}: Props) {
  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1} flexShrink={0}>
      <Text>
        {TABS.map(tab => (tab === state.activeTab ? `[${tab}]` : tab)).join(' ')}
      </Text>
      <Text dimColor>
        {state.permissionMode} | {state.verbosity} | {state.running ? 'RUNNING' : 'IDLE'}  ·  tab/shift+tab cycle views  ·  /help  ·  /stop  ·  /verbosity
      </Text>
    </Box>
  );
}

export {TABS};
