import React from 'react';
import {Box, Text} from 'ink';
import wrapAnsi from 'wrap-ansi';
import type {AppState, ConversationEntry} from '../domain/types.js';
import {
  classifyConversationLine,
  isAgentProseEntry,
  isDimLine,
  planSummaryFor,
  speakerColor,
  TOOL_CALL_MARKER,
} from './format.js';
import {rewriteBulletLines, tokenizeInlineMarkdown, type MarkdownSegment} from './markdown.js';

interface Props {
  state: AppState;
  entries: ConversationEntry[];
  width: number;
  height: number;
  showPlanSummary?: boolean;
}

interface Line {
  key: string;
  color: ReturnType<typeof speakerColor>;
  dim: boolean;
  segments: MarkdownSegment[];
}

export function ConversationView({state, entries, width, height, showPlanSummary = false}: Props) {
  const summary = showPlanSummary ? planSummaryFor(state) : undefined;
  const budget = summary ? Math.max(1, height - 2) : height;
  const lines = buildLines(entries, width, state.agents, budget);

  return (
    <Box flexDirection="column" height={height} paddingX={1}>
      {summary ? (
        <Box marginBottom={1}>
          <Text bold color="cyan">Plan: </Text>
          <Text>{summary}</Text>
        </Box>
      ) : null}
      {lines.map(line => (
        <Box key={line.key} flexDirection="row">
          {line.segments.map((segment, index) => (
            segment.code === true
              ? <Text key={`${line.key}-${index}`} inverse>{segment.text}</Text>
              : <Text key={`${line.key}-${index}`} bold={segment.bold === true} color={line.color} dimColor={line.dim}>{segment.text}</Text>
          ))}
        </Box>
      ))}
    </Box>
  );
}

function bodyTextFor(item: ConversationEntry): string {
  if (classifyConversationLine(item) === 'tool-call') {
    return `${TOOL_CALL_MARKER} ${item.text}`;
  }
  if (isAgentProseEntry(item)) {
    return rewriteBulletLines(item.text);
  }
  return item.text;
}

function buildLines(entries: ConversationEntry[], width: number, agents: AppState['agents'], maxLines: number): Line[] {
  const lines: Line[] = [];
  for (const item of entries) {
    const prefix = `${item.speaker}: `;
    const kind = classifyConversationLine(item);
    const parseMarkdown = isAgentProseEntry(item);
    const wrapped = wrapAnsi(`${prefix}${bodyTextFor(item)}`, width, {hard: true}).split('\n');
    const color = kind === 'tool-call' ? 'cyan' : speakerColor(item.speaker, agents);
    const dim = kind === 'tool-call' || isDimLine(item);
    wrapped.forEach((text, index) => {
      lines.push({
        key: `${item.id}-${index}`,
        color,
        dim,
        segments: parseMarkdown ? tokenizeInlineMarkdown(text) : [{text}],
      });
    });
  }
  return lines.slice(-maxLines);
}
