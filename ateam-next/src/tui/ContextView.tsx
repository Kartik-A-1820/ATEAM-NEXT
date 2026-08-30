import React from 'react';
import {Box, Text} from 'ink';
import type {AppState} from '../domain/types.js';

interface Props {
  state: AppState;
  height: number;
}

export function ContextView({state, height}: Props) {
  const tasks = Object.values(state.tasks);
  const runningCount = tasks.filter(task => task.status === 'RUNNING').length;
  const memoryLines = state.conversation
    .filter(item => item.speaker === 'System' && item.text.startsWith('Memory '))
    .slice(-5);

  return (
    <Box flexDirection="column" height={height} paddingX={1}>
      <Text>Permission mode: {state.permissionMode}</Text>
      <Text>Verbosity: {state.verbosity}</Text>
      <Text>Running: {state.running ? 'yes' : 'no'}</Text>
      <Text>Tasks: {tasks.length} total, {runningCount} running</Text>
      <Text dimColor>The latest user instruction always supersedes the active plan.</Text>
      {memoryLines.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Recent memory</Text>
          {memoryLines.map(item => <Text key={item.id}>{item.text}</Text>)}
        </Box>
      ) : null}
    </Box>
  );
}
