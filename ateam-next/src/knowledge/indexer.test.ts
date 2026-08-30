import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe, expect, it} from 'vitest';
import {indexDirectory, indexFile} from './indexer.js';

describe('indexFile', () => {
  it('extracts top-level TS symbols with kinds and export flags', () => {
    const outline = indexFile('sample.ts', [
      'export function loadUser(id: string) {',
      '  return id;',
      '}',
      'class UserService {',
      '  run() {}',
      '}',
      'export const userLimit = 3;',
    ].join('\n'));

    expect(outline.language).toBe('typescript');
    expect(outline.symbols.map(symbol => ({
      name: symbol.name,
      kind: symbol.kind,
      exported: symbol.exported,
      startLine: symbol.startLine,
    }))).toEqual([
      {name: 'loadUser', kind: 'function', exported: true, startLine: 1},
      {name: 'UserService', kind: 'class', exported: false, startLine: 4},
      {name: 'userLimit', kind: 'const', exported: true, startLine: 7},
    ]);
    expect(outline.symbols[0]?.signature).toContain('loadUser');
  });

  it('returns an unknown empty outline for unsupported files', () => {
    expect(indexFile('README.md', '# docs')).toEqual({path: 'README.md', language: 'unknown', symbols: []});
  });
});

describe('indexDirectory', () => {
  it('indexes supported source files and skips tests, declarations, and excluded directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ateam-kg-'));
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'src', 'main.ts'), 'export function main() {}\n');
    await writeFile(join(root, 'src', 'view.tsx'), 'export const View = () => null;\n');
    await writeFile(join(root, 'src', 'main.test.ts'), 'export function noisyTest() {}\n');
    await writeFile(join(root, 'src', 'types.d.ts'), 'export interface Declared {}\n');
    await writeFile(join(root, 'node_modules', 'dep.ts'), 'export function dependency() {}\n');

    const outlines = await indexDirectory(root);

    expect(outlines.map(outline => outline.path).sort()).toEqual([
      join(root, 'src', 'main.ts'),
      join(root, 'src', 'view.tsx'),
    ].sort());
    expect(outlines.flatMap(outline => outline.symbols).map(symbol => symbol.name).sort()).toEqual(['View', 'main']);
  });
});
