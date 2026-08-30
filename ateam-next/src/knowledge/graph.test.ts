import {describe, expect, it} from 'vitest';
import {buildGraphStore, CodeGraphStore} from './graph.js';
import type {FileOutline} from './indexer.js';

describe('CodeGraphStore', () => {
  it('replaces, removes, and reports graph stats', () => {
    const store = new CodeGraphStore();
    store.replaceFile(outline('a.ts', ['alpha']));
    store.replaceFile(outline('b.ts', ['beta', 'gamma']));

    expect(store.stats()).toEqual({fileCount: 2, symbolCount: 3});
    expect(store.allSymbols().map(symbol => symbol.name)).toEqual(['alpha', 'beta', 'gamma']);

    store.replaceFile(outline('a.ts', ['delta']));
    expect(store.stats()).toEqual({fileCount: 2, symbolCount: 3});
    expect(store.allSymbols().map(symbol => symbol.name)).toEqual(['delta', 'beta', 'gamma']);

    store.removeFile('b.ts');
    expect(store.stats()).toEqual({fileCount: 1, symbolCount: 1});
  });

  it('builds from outlines', () => {
    const store = buildGraphStore([outline('a.ts', ['alpha'])]);
    expect(store.stats()).toEqual({fileCount: 1, symbolCount: 1});
  });
});

function outline(path: string, names: string[]): FileOutline {
  return {
    path,
    language: 'typescript',
    symbols: names.map((name, index) => ({
      file: path,
      name,
      kind: 'function',
      signature: `function ${name}()`,
      startLine: index + 1,
      endLine: index + 1,
      exported: true,
    })),
  };
}
