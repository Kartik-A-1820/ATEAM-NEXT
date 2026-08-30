import React from 'react';
import {Box, Text} from 'ink';
import type {AppState} from '../domain/types.js';
import {formatCooldownCountdown, symbolFor} from './format.js';

interface Props {
  state: AppState;
  height: number;
}

export function AgentsView({state, height}: Props) {
  const agents = Object.values(state.agents);
  const now = Date.now();
  return (
    <Box flexDirection="column" height={height} paddingX={1}>
      <Text dimColor>{'ID'.padEnd(8)}{'STATUS'.padEnd(12)}{'VERSION'.padEnd(10)}{'AUTH'.padEnd(10)}{'TASKS'.padEnd(7)}ERROR</Text>
      {agents.map(agent => {
        const countdown = formatCooldownCountdown(agent.cooldownUntil, now);
        const detail = countdown
          ? `cooling down, ${countdown}${agent.cooldownReason ? ` (${agent.cooldownReason})` : ''}`
          : agent.currentTaskObjective
            ? `working on: ${agent.currentTaskObjective}`
            : undefined;
        return (
          <Box key={agent.id} flexDirection="column">
            <Text color={agent.color}>
              {symbolFor(agent.availability)} {agent.displayName.padEnd(6)}{agent.availability.padEnd(12)}{(agent.version ?? '-').padEnd(10)}{String(agent.authenticated).padEnd(10)}{String(agent.runningTaskCount).padEnd(7)}{agent.lastError ?? '-'}
            </Text>
            {detail ? <Text dimColor>{'  -> '}{detail}</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}
