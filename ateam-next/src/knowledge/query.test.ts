import {describe, expect, it} from 'vitest';
import {buildGraphStore, CodeGraphStore} from './graph.js';
import {queryRelevantContext, queryRelevantContextSafe} from './query.js';
import type {CodeSymbol, FileOutline} from './indexer.js';

describe('queryRelevantContext', () => {
  it('returns top scoring symbols and distinct files within budget', () => {
    const store = buildGraphStore([
      outline('src/auth/session.ts', [symbol('src/auth/session.ts', 'createSession', 1)]),
      outline('src/billing/invoice.ts', [symbol('src/billing/invoice.ts', 'createInvoice', 1)]),
    ]);

    const context = queryRelevantContext(store, 'fix auth session creation', 500);

    expect(context.symbols[0]).toContain('createSession(function)');
    expect(context.files).toEqual(['src/auth/session.ts']);
  });

  it('returns empty context when nothing scores', () => {
    const store = buildGraphStore([outline('src/billing/invoice.ts', [symbol('src/billing/invoice.ts', 'createInvoice', 1)])]);
    expect(queryRelevantContext(store, 'auth session', 500)).toEqual({symbols: [], files: []});
  });
});

describe('queryRelevantContextSafe', () => {
  it('fails open for a missing store', async () => {
    await expect(queryRelevantContextSafe(undefined, 'auth')).resolves.toEqual({symbols: [], files: []});
  });

  it('fails open when store access throws', async () => {
    class ThrowingStore extends CodeGraphStore {
      override allSymbols(): CodeSymbol[] {
        throw new Error('corrupt graph');
      }
    }

    await expect(queryRelevantContextSafe(new ThrowingStore(), 'auth')).resolves.toEqual({symbols: [], files: []});
  });

  it('fails open on an elapsed timeout budget', async () => {
    const store = buildGraphStore([outline('src/auth/session.ts', [symbol('src/auth/session.ts', 'createSession', 1)])]);
    await expect(queryRelevantContextSafe(store, 'auth session', 500, 0)).resolves.toEqual({symbols: [], files: []});
  });
});

function outline(path: string, symbols: CodeSymbol[]): FileOutline {
  return {path, language: 'typescript', symbols};
}

function symbol(file: string, name: string, startLine: number): CodeSymbol {
  return {
    file,
    name,
    kind: 'function',
    signature: `function ${name}()`,
    startLine,
    endLine: startLine,
    exported: true,
  };
}
