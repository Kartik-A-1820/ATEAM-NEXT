import React from 'react';
import {Box, Text} from 'ink';
import wrapAnsi from 'wrap-ansi';

interface Props {
  log: string[];
  width: number;
  height: number;
}

export function LogsView({log, width, height}: Props) {
  const lines = log.slice(-Math.max(1, height));
  return (
    <Box flexDirection="column" height={height} paddingX={1}>
      {lines.length === 0 ? <Text dimColor>No events recorded yet.</Text> : lines.map((line, index) => (
        <Text key={`${index}-${line}`} dimColor>{wrapAnsi(line, width, {hard: true})}</Text>
      ))}
    </Box>
  );
}
