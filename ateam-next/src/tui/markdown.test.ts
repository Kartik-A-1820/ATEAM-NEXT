import {describe, expect, it} from 'vitest';
import {
  isBulletLine,
  parseMarkdownLine,
  rewriteBulletLine,
  rewriteBulletLines,
  tokenizeInlineMarkdown,
} from './markdown.js';

describe('tokenizeInlineMarkdown', () => {
  it('marks **bold** as a bold segment', () => {
    expect(tokenizeInlineMarkdown('**bold**')).toEqual([{text: 'bold', bold: true}]);
  });

  it('marks `code` as a code segment', () => {
    expect(tokenizeInlineMarkdown('`code`')).toEqual([{text: 'code', code: true}]);
  });

  it('passes plain text through unchanged', () => {
    expect(tokenizeInlineMarkdown('just words')).toEqual([{text: 'just words'}]);
  });

  it('keeps mixed bold and code segments in order', () => {
    expect(tokenizeInlineMarkdown('see **bold** and `code` now')).toEqual([
      {text: 'see '},
      {text: 'bold', bold: true},
      {text: ' and '},
      {text: 'code', code: true},
      {text: ' now'},
    ]);
  });

  it('leaves unclosed markers as literal text', () => {
    expect(tokenizeInlineMarkdown('**not closed')).toEqual([{text: '**not closed'}]);
    expect(tokenizeInlineMarkdown('`not closed')).toEqual([{text: '`not closed'}]);
  });

  it('does not parse nested markup inside a code span', () => {
    expect(tokenizeInlineMarkdown('`**still code**`')).toEqual([{text: '**still code**', code: true}]);
  });
});

describe('bullet lines', () => {
  it('recognizes "- " and "* " list lines', () => {
    expect(isBulletLine('- item')).toBe(true);
    expect(isBulletLine('* item')).toBe(true);
    expect(isBulletLine('-item')).toBe(false);
    expect(isBulletLine(' - item')).toBe(false);
    expect(isBulletLine('plain')).toBe(false);
  });

  it('rewrites a bullet line with an indent and bullet marker', () => {
    expect(rewriteBulletLine('- item')).toBe('  • item');
    expect(rewriteBulletLine('* item')).toBe('  • item');
    expect(rewriteBulletLine('plain')).toBe('plain');
  });

  it('rewrites only matching lines in a multiline block', () => {
    expect(rewriteBulletLines('- one\nplain\n* two')).toBe('  • one\nplain\n  • two');
  });

  it('parseMarkdownLine flags bullets and tokenizes the remainder', () => {
    expect(parseMarkdownLine('- item')).toEqual({
      bullet: true,
      segments: [{text: '  • '}, {text: 'item'}],
    });
    expect(parseMarkdownLine('- **bold** item')).toEqual({
      bullet: true,
      segments: [{text: '  • '}, {text: 'bold', bold: true}, {text: ' item'}],
    });
    expect(parseMarkdownLine('no list')).toEqual({
      bullet: false,
      segments: [{text: 'no list'}],
    });
  });
});
