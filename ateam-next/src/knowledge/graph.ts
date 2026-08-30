import type {CodeSymbol, FileOutline} from './indexer.js';

export class CodeGraphStore {
  private readonly files = new Map<string, FileOutline>();
  private symbolsView: CodeSymbol[] = [];

  replaceFile(outline: FileOutline): void {
    this.files.set(outline.path, outline);
    this.rebuildSymbols();
  }

  removeFile(path: string): void {
    this.files.delete(path);
    this.rebuildSymbols();
  }

  allSymbols(): CodeSymbol[] {
    return [...this.symbolsView];
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
