import type {CodeSymbol} from './indexer.js';
import type {CodeGraphStore} from './graph.js';

export interface RelevantContext {
  symbols: string[];
  files: string[];
}

const stopwords = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'into',
  'task',
  'code',
  'file',
  'fix',
  'add',
  'new',
  'use',
  'using',
  'implement',
]);

export function queryRelevantContext(store: CodeGraphStore, objective: string, budgetChars = 1500): RelevantContext {
  const symbols = store.allSymbols();
  if (symbols.length === 0) return {symbols: [], files: []};

  const tokens = tokenize(objective);
  if (tokens.length === 0) return {symbols: [], files: []};

  const scored = symbols
    .map(symbol => ({symbol, score: scoreSymbol(symbol, tokens)}))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.symbol.file.localeCompare(b.symbol.file) || a.symbol.name.localeCompare(b.symbol.name));

  const selectedSymbols: string[] = [];
  const selectedFiles: string[] = [];
  const seenFiles = new Set<string>();
  let usedChars = 0;

  for (const item of scored) {
    const formatted = formatSymbol(item.symbol);
    if (selectedSymbols.length > 0 && usedChars + formatted.length > budgetChars) continue;
    if (selectedSymbols.length === 0 && formatted.length > budgetChars) continue;
    selectedSymbols.push(formatted);
    usedChars += formatted.length;
    if (!seenFiles.has(item.symbol.file)) {
      seenFiles.add(item.symbol.file);
      selectedFiles.push(item.symbol.file);
    }
  }

  return {symbols: selectedSymbols, files: selectedFiles};
}

export async function queryRelevantContextSafe(
  store: CodeGraphStore | undefined,
  objective: string,
  budgetChars?: number,
  timeoutMs = 2000,
): Promise<RelevantContext> {
  if (!store) return {symbols: [], files: []};
  if (timeoutMs <= 0) return {symbols: [], files: []};

  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => queryRelevantContext(store, objective, budgetChars)),
      new Promise<RelevantContext>(resolve => {
        timer = setTimeout(() => resolve({symbols: [], files: []}), timeoutMs);
      }),
    ]);
  } catch {
    return {symbols: [], files: []};
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function tokenize(objective: string): string[] {
  return [...new Set(objective.toLowerCase().split(/\W+/).filter(token => token.length > 2 && !stopwords.has(token)))];
}

function scoreSymbol(symbol: CodeSymbol, tokens: string[]): number {
  const name = symbol.name.toLowerCase();
  const file = symbol.file.toLowerCase();
  return tokens.reduce((score, token) => score + (name.includes(token) ? 2 : 0) + (file.includes(token) ? 1 : 0), 0);
}

function formatSymbol(symbol: CodeSymbol): string {
  return `${symbol.file}:${symbol.startLine} ${symbol.name}(${symbol.kind}): ${symbol.signature}`;
}
