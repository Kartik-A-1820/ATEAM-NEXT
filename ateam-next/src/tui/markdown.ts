export interface MarkdownSegment {
  text: string;
  bold?: boolean;
  code?: boolean;
}

export interface ParsedMarkdownLine {
  bullet: boolean;
  segments: MarkdownSegment[];
}

const BULLET_PREFIXES = ['- ', '* '] as const;
const BULLET_MARKER = '  • ';

export function isBulletLine(line: string): boolean {
  return BULLET_PREFIXES.some(prefix => line.startsWith(prefix));
}

export function rewriteBulletLine(line: string): string {
  if (!isBulletLine(line)) return line;
  return `${BULLET_MARKER}${line.slice(2)}`;
}

export function rewriteBulletLines(text: string): string {
  return text.split('\n').map(rewriteBulletLine).join('\n');
}

export function parseMarkdownLine(line: string): ParsedMarkdownLine {
  const bullet = isBulletLine(line);
  const content = bullet ? line.slice(2) : line;
  const inner = tokenizeInlineMarkdown(content);
  if (!bullet) return {bullet: false, segments: inner};
  return {bullet: true, segments: [{text: BULLET_MARKER}, ...inner]};
}

/**
 * Line-oriented tokenizer for `**bold**` and `code` spans.
 * Unclosed markers are left as literal text. Nested markup is not parsed.
 */
export function tokenizeInlineMarkdown(line: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let index = 0;

  const push = (text: string, style?: Pick<MarkdownSegment, 'bold' | 'code'>): void => {
    if (text.length === 0) return;
    const last = segments.at(-1);
    if (last && last.bold === style?.bold && last.code === style?.code) {
      last.text += text;
      return;
    }
    segments.push(style === undefined ? {text} : {text, ...style});
  };

  while (index < line.length) {
    const boldAt = line.indexOf('**', index);
    const codeAt = line.indexOf('`', index);
    const nextBold = boldAt === -1 ? Number.POSITIVE_INFINITY : boldAt;
    const nextCode = codeAt === -1 ? Number.POSITIVE_INFINITY : codeAt;

    if (nextBold === Number.POSITIVE_INFINITY && nextCode === Number.POSITIVE_INFINITY) {
      push(line.slice(index));
      break;
    }

    if (nextCode < nextBold) {
      const close = line.indexOf('`', codeAt + 1);
      if (close === -1) {
        push(line.slice(index));
        break;
      }
      push(line.slice(index, codeAt));
      push(line.slice(codeAt + 1, close), {code: true});
      index = close + 1;
      continue;
    }

    const close = line.indexOf('**', boldAt + 2);
    if (close === -1) {
      push(line.slice(index));
      break;
    }
    push(line.slice(index, boldAt));
    push(line.slice(boldAt + 2, close), {bold: true});
    index = close + 2;
  }

  return segments.length > 0 ? segments : [{text: line}];
}
