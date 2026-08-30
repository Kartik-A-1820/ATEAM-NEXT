import React from 'react';
import {Box, Text} from 'ink';
import type {AgentAvailability, AppState} from '../domain/types.js';

interface Props {
  state: AppState;
  height: number;
}

const neverConfiguredAvailabilities = new Set<AgentAvailability>([
  'NOT_INSTALLED',
  'NOT_CONFIGURED',
  'SIGNED_OUT',
  'DISABLED',
  'UNKNOWN',
]);

export function EmptyState({height}: Props) {
  return (
    <Box flexDirection="column" height={height} paddingX={1}>
      <Text bold color="cyan">No agents are ready yet.</Text>
      <Text>Ateam needs at least one provider CLI installed and authenticated: Codex, Claude, AGY, or Grok.</Text>
      <Text>Run <Text color="cyan">/doctor</Text> to check setup and see what needs attention.</Text>
    </Box>
  );
}

export function shouldShowEmptyState(state: AppState): boolean {
  return (
    state.activeTab === 'Plan' &&
    state.conversation.length <= 1 &&
    Object.values(state.agents).every(agent => neverConfiguredAvailabilities.has(agent.availability))
  );
}
