import React from 'react';
import {Box, Text} from 'ink';
import type {AppState} from '../domain/types.js';
import {symbolFor} from './format.js';

interface Props {
  state: AppState;
  height: number;
}

const taskSymbol: Record<string, string> = {
  PENDING: 'o',
  READY: 'o',
  RUNNING: '~',
  BLOCKED: '!',
  COMPLETED: '*',
  FAILED: '!',
  CANCELLED: 'x',
  INVALIDATED: 'x',
};

export function TasksView({state, height}: Props) {
  const tasks = Object.values(state.tasks);
  if (tasks.length === 0) {
    return (
      <Box flexDirection="column" height={height} paddingX={1}>
        <Text>No tasks yet.</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" height={height} paddingX={1}>
      <Text dimColor>{'ID'.padEnd(8)}{'STATUS'.padEnd(13)}{'AGENT'.padEnd(9)}{'DEPS'.padEnd(12)}OBJECTIVE</Text>
      {tasks.map(task => (
        <Box key={task.id} flexDirection="column">
          <Text>
            {(taskSymbol[task.status] ?? symbolFor(task.status))} {task.id.padEnd(6)}{task.status.padEnd(13)}{(task.assignedAgent ?? '-').padEnd(9)}{(task.dependencies.join(',') || '-').padEnd(12)}{task.objective}
          </Text>
          {task.attempts && task.attempts.length > 1 ? (
            <Text dimColor>{'  -> attempts: '}{task.attempts.map(attempt => `${attempt.agentId} (${attempt.reason})`).join(' -> ')}</Text>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}
