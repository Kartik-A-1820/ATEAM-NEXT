import {describe, expect, it} from 'vitest';
import {buildGraphStore, CodeGraphStore, loadPersistedGraphStore, savePersistedGraphStore} from './graph.js';
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

  it('exposes outlines without sharing mutable graph internals', () => {
    const store = buildGraphStore([outline('a.ts', ['alpha'])]);
    const outlines = store.allOutlines();
    outlines[0]?.symbols.push({
      file: 'a.ts',
      name: 'mutated',
      kind: 'function',
      signature: 'function mutated()',
      startLine: 2,
      endLine: 2,
      exported: true,
    });

    expect(store.stats()).toEqual({fileCount: 1, symbolCount: 1});
    expect(store.allSymbols().map(symbol => symbol.name)).toEqual(['alpha']);
  });

  it('reconstructs a graph from persisted outlines', () => {
    const saved = [outline('a.ts', ['alpha']), outline('b.ts', ['beta', 'gamma'])];
    const graph = loadPersistedGraphStore({loadGraphOutlines: () => saved});

    expect(graph.stats()).toEqual({fileCount: 2, symbolCount: 3});
    expect(graph.allOutlines()).toEqual(saved);
  });

  it('fails open when persisted graph loading or saving throws', () => {
    const graph = loadPersistedGraphStore({
      loadGraphOutlines: () => {
        throw new Error('database unavailable');
      },
    });

    expect(graph.stats()).toEqual({fileCount: 0, symbolCount: 0});
    expect(() => savePersistedGraphStore({
      saveGraphOutlines: () => {
        throw new Error('database unavailable');
      },
    }, buildGraphStore([outline('a.ts', ['alpha'])]))).not.toThrow();
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
