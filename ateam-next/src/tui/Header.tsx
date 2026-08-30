import React from 'react';
import {Box, Text} from 'ink';
import type {AppState} from '../domain/types.js';
import {agentTaskSuffix, derivePhase, formatElapsed, symbolFor} from './format.js';

interface Props {
  state: AppState;
}

export function Header({state}: Props) {
  const agents = Object.values(state.agents);
  const ready = agents.filter(agent => agent.availability === 'READY').length;
  const phase = derivePhase(state);
  const elapsed = formatElapsed(state.startedAt);

  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1} flexShrink={0}>
      <Text>
        <Text bold>ATEAM</Text>
        {'  '}
        {ready}/{agents.length} agents ready | {state.permissionMode} | {state.verbosity} | {phase} {elapsed}
      </Text>
      <Box>
        {agents.map((agent, index) => (
          <Text key={agent.id} color={agent.color}>
            {index > 0 ? '   ' : ''}
            {symbolFor(agent.availability)} {agent.displayName} {agent.availability}
            {agentTaskSuffix(agent)}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
