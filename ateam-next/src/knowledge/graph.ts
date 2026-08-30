import type {CodeSymbol, FileOutline} from './indexer.js';
import type {AteamStore} from '../storage/store.js';

export class CodeGraphStore {
  private readonly files = new Map<string, FileOutline>();
  private symbolsView: CodeSymbol[] = [];

  replaceFile(outline: FileOutline): void {
    this.files.set(outline.path, cloneOutline(outline));
    this.rebuildSymbols();
  }

  removeFile(path: string): void {
    this.files.delete(path);
    this.rebuildSymbols();
  }

  allSymbols(): CodeSymbol[] {
    return this.symbolsView.map(symbol => ({...symbol}));
  }

  allOutlines(): FileOutline[] {
    return [...this.files.values()].map(cloneOutline);
  }

  stats(): {fileCount: number; symbolCount: number} {
    return {fileCount: this.files.size, symbolCount: this.symbolsView.length};
  }

  private rebuildSymbols(): void {
    this.symbolsView = [...this.files.values()].flatMap(outline => outline.symbols);
  }
}

export function buildGraphStore(outlines: FileOutline[]): CodeGraphStore {
  const store = new CodeGraphStore();
  for (const outline of outlines) store.replaceFile(outline);
  return store;
}

export function loadPersistedGraphStore(store: Pick<AteamStore, 'loadGraphOutlines'> | undefined): CodeGraphStore {
  try {
    return buildGraphStore(store?.loadGraphOutlines() ?? []);
  } catch {
    return new CodeGraphStore();
  }
}

export function savePersistedGraphStore(store: Pick<AteamStore, 'saveGraphOutlines'> | undefined, graph: CodeGraphStore): void {
  try {
    store?.saveGraphOutlines(graph.allOutlines());
  } catch {
    // Fail open: graph persistence must never block task dispatch or indexing.
  }
}

function cloneOutline(outline: FileOutline): FileOutline {
  return {
    path: outline.path,
    language: outline.language,
    symbols: outline.symbols.map(symbol => ({...symbol})),
  };
}
