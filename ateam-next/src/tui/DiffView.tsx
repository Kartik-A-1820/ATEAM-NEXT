import React from 'react';
import {Box, Text} from 'ink';
import {runProcess} from '../process/runner.js';

interface Props {
  height: number;
}

type DiffStatus = 'loading' | 'ready' | 'empty' | 'not-git-repo' | 'git-missing' | 'error';
type DiffLineKind = 'addition' | 'deletion' | 'hunk' | 'indicator' | 'default';

interface DiffState {
  status: DiffStatus;
  message?: string;
  statOutput?: string;
  diffOutput?: string;
}

export interface DiffDisplayLine {
  text: string;
  kind: DiffLineKind;
}

export function DiffView({height}: Props) {
  const [state, setState] = React.useState<DiffState>({status: 'loading'});
  const lines = React.useMemo(
    () => state.status === 'ready' ? buildDiffLines(state.statOutput ?? '', state.diffOutput ?? '', height) : [],
    [height, state.diffOutput, state.statOutput, state.status],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    async function loadDiff(): Promise<void> {
      try {
        const [stat, diff] = await Promise.all([
          runProcess({executable: 'git', args: ['diff', '--stat'], cwd: process.cwd(), timeoutMs: 10_000, signal: controller.signal}),
          runProcess({executable: 'git', args: ['diff'], cwd: process.cwd(), timeoutMs: 10_000, signal: controller.signal}),
        ]);
        if (!mounted || controller.signal.aborted) return;
        const failure = classifyGitFailure(stat.exitCode === 0 ? diff : stat);
        if (failure !== undefined) {
          setState({status: failure.status, message: failure.message});
          return;
        }
        if (stat.stdout.trim() === '' && diff.stdout.trim() === '') {
          setState({status: 'empty', message: 'No workspace changes yet.'});
          return;
        }
        setState({status: 'ready', statOutput: stat.stdout, diffOutput: diff.stdout});
      } catch (error) {
        if (!mounted || controller.signal.aborted) return;
        setState(classifyThrownGitError(error));
      }
    }

    void loadDiff();
    return () => {
      mounted = false;
      controller.abort();
    };
  }, []);

  return (
    <Box flexDirection="column" height={height} paddingX={1}>
      {state.status === 'loading' ? <Text dimColor>Loading diff...</Text> : null}
      {state.message !== undefined ? <Text>{state.message}</Text> : null}
      {lines.map((line, index) => (
        <Text
          key={`${index}-${line.text}`}
          color={colorForLine(line.kind)}
          dimColor={line.kind === 'hunk' || line.kind === 'indicator'}
        >
          {line.text}
        </Text>
      ))}
    </Box>
  );
}

export function buildDiffLines(statOutput: string, diffOutput: string, height: number): DiffDisplayLine[] {
  const rawLines = [...splitLines(statOutput), ...(statOutput.trim() && diffOutput.trim() ? [''] : []), ...splitLines(diffOutput)];
  const lines = rawLines.map(classifyDiffLine);
  const maxLines = Math.max(0, height);
  if (lines.length <= maxLines) return lines;
  if (maxLines === 0) return [];

  const shownCount = Math.max(0, maxLines - 1);
  const hiddenCount = lines.length - shownCount;
  return [
    {text: `${hiddenCount} more lines, showing last ${shownCount}`, kind: 'indicator'},
    ...lines.slice(-shownCount),
  ];
}

export function classifyDiffLine(text: string): DiffDisplayLine {
  if (text.startsWith('@@')) return {text, kind: 'hunk'};
  if (text.startsWith('+') && !text.startsWith('+++')) return {text, kind: 'addition'};
  if (text.startsWith('-') && !text.startsWith('---')) return {text, kind: 'deletion'};
  return {text, kind: 'default'};
}

function splitLines(value: string): string[] {
  return value.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').filter((line, index, lines) => line !== '' || index < lines.length - 1);
}

function colorForLine(kind: DiffLineKind): 'green' | 'red' | 'cyan' | undefined {
  if (kind === 'addition') return 'green';
  if (kind === 'deletion') return 'red';
  if (kind === 'hunk') return 'cyan';
  return undefined;
}

function classifyGitFailure(result: {exitCode: number | null; stderr: string}): Pick<DiffState, 'status' | 'message'> | undefined {
  if (result.exitCode === 0) return undefined;
  const stderr = result.stderr.toLowerCase();
  if (stderr.includes('not a git repository')) {
    return {status: 'not-git-repo', message: 'Not inside a git repository.'};
  }
  return {status: 'error', message: 'Unable to load workspace diff.'};
}

function classifyThrownGitError(error: unknown): DiffState {
  if (isNodeError(error) && error.code === 'ENOENT') {
    return {status: 'git-missing', message: 'git is not installed or not on PATH.'};
  }
  return {status: 'error', message: 'Unable to load workspace diff.'};
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
