import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import ts from 'typescript';

export interface CodeSymbol {
  file: string;
  name: string;
  kind: string;
  signature: string;
  startLine: number;
  endLine: number;
  exported: boolean;
}

export interface FileOutline {
  path: string;
  language: string;
  symbols: CodeSymbol[];
}

const supportedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);
const excludedDirectories = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'out', '.orchestrator']);

export function indexFile(path: string, content: string): FileOutline {
  const language = languageForPath(path);
  if (language === 'unknown') return {path, language, symbols: []};

  try {
    const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKindForPath(path));
    const diagnosticsSource = source as ts.SourceFile & {parseDiagnostics?: readonly ts.Diagnostic[]};
    if ((diagnosticsSource.parseDiagnostics?.length ?? 0) > 0) return {path, language: 'unknown', symbols: []};
    const symbols: CodeSymbol[] = [];

    ts.forEachChild(source, node => {
      const symbol = symbolForNode(path, source, node);
      if (symbol) symbols.push(symbol);
    });

    return {path, language, symbols};
  } catch {
    return {path, language: 'unknown', symbols: []};
  }
}

export async function indexDirectory(rootDir: string): Promise<FileOutline[]> {
  const outlines: FileOutline[] = [];

  async function walk(directory: string): Promise<void> {
    let entries: Array<{name: string; isDirectory(): boolean; isFile(): boolean}>;
    try {
      entries = await readdir(directory, {withFileTypes: true});
    } catch {
      return;
    }

    await Promise.all(entries.map(async entry => {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) await walk(fullPath);
        return;
      }
      if (!entry.isFile() || !shouldIndexPath(entry.name)) return;
      try {
        outlines.push(indexFile(fullPath, await readFile(fullPath, 'utf8')));
      } catch {
        // Fail open: unreadable files are simply absent from the graph.
      }
    }));
  }

  await walk(rootDir).catch(() => undefined);
  return outlines;
}

function symbolForNode(path: string, source: ts.SourceFile, node: ts.Node): CodeSymbol | undefined {
  if (ts.isFunctionDeclaration(node) && node.name) {
    return makeSymbol(path, source, node, node.name.text, 'function', signatureWithoutBody(node, source), isExported(node));
  }
  if (ts.isClassDeclaration(node) && node.name) {
    return makeSymbol(path, source, node, node.name.text, 'class', signatureWithoutBody(node, source), isExported(node));
  }
  if (ts.isInterfaceDeclaration(node)) {
    return makeSymbol(path, source, node, node.name.text, 'interface', firstLine(node, source), isExported(node));
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return makeSymbol(path, source, node, node.name.text, 'type', firstLine(node, source), isExported(node));
  }
  if (ts.isVariableStatement(node) && isExported(node)) {
    const declarationList = node.declarationList;
    const isConst = (declarationList.flags & ts.NodeFlags.Const) !== 0;
    if (!isConst) return undefined;
    const declarations = declarationList.declarations.filter(declaration => ts.isIdentifier(declaration.name));
    if (declarations.length !== 1) return undefined;
    const declaration = declarations[0];
    return makeSymbol(path, source, declaration, declaration.name.getText(source), 'const', firstLine(node, source), true);
  }
  return undefined;
}

function makeSymbol(
  file: string,
  source: ts.SourceFile,
  node: ts.Node,
  name: string,
  kind: string,
  signature: string,
  exported: boolean,
): CodeSymbol {
  const start = source.getLineAndCharacterOfPosition(node.getStart(source));
  const end = source.getLineAndCharacterOfPosition(node.getEnd());
  return {
    file,
    name,
    kind,
    signature,
    startLine: start.line + 1,
    endLine: end.line + 1,
    exported,
  };
}

function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false);
}

function firstLine(node: ts.Node, source: ts.SourceFile): string {
  return node.getText(source).split(/\r?\n/, 1)[0].trim();
}

function signatureWithoutBody(node: ts.Node, source: ts.SourceFile): string {
  const text = node.getText(source);
  const brace = text.indexOf('{');
  if (brace < 0) return firstLine(node, source);
  return `${text.slice(0, brace).trim()} { ... }`;
}

function shouldIndexPath(path: string): boolean {
  if (path.endsWith('.d.ts')) return false;
  if (/\.(test|spec)\.tsx?$/.test(path)) return false;
  return supportedExtensions.has(extensionForPath(path));
}

function languageForPath(path: string): string {
  const extension = extensionForPath(path);
  if (extension === '.ts' || extension === '.tsx') return 'typescript';
  if (extension === '.js' || extension === '.jsx') return 'javascript';
  return 'unknown';
}

function extensionForPath(path: string): string {
  const match = /\.[^.\\/]+$/.exec(path.toLowerCase());
  return match?.[0] ?? '';
}

function scriptKindForPath(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (path.endsWith('.js')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
