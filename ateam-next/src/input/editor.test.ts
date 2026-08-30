import {rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {applyEdit, createInputEditor, insertImagePlaceholder, insertText, submit} from './editor.js';

describe('input editor', () => {
  const tempFiles: string[] = [];
  afterEach(() => {
    for (const file of tempFiles.splice(0)) {
      rmSync(file, {force: true});
    }
  });

  it('supports insertion, cursor movement, deletion, and unicode text', () => {
    let state = createInputEditor();
    state = insertText(state, 'hello 🌍');
    state = applyEdit(state, 'left');
    state = insertText(state, '!');
    expect(state.value).toBe('hello !🌍');
    state = applyEdit(state, 'backspace');
    expect(state.value).toBe('hello 🌍');
  });

  it('supports multiline submission and history', () => {
    let state = insertText(createInputEditor(), 'line one');
    state = applyEdit(state, 'newline');
    state = insertText(state, 'line two');
    const result = submit(state);
    expect(result.submitted).toEqual({text: 'line one\nline two', images: []});
    const recalled = applyEdit(result.state, 'historyPrev');
    expect(recalled.value).toBe('line one\nline two');
  });

  it('compacts a large paste to a placeholder and expands it back on submit', () => {
    const paste = Array.from({length: 250}, (_, index) => `line ${index} with unicode ${index % 2 === 0 ? '✅' : 'नमस्ते'}`).join('\n');
    const state = insertText(createInputEditor(), paste);
    expect(state.value).not.toBe(paste);
    expect(state.value).toMatch(/^\[[\d,]+ chars pasted #1]$/);
    expect(state.value.length).toBeLessThan(50);

    const result = submit(state);
    expect(result.submitted).toEqual({text: paste, images: []});
  });

  it('keeps a short paste inline, uncompacted', () => {
    const state = insertText(createInputEditor(), 'a short paste');
    expect(state.value).toBe('a short paste');
  });

  it('deletes a pasted placeholder as one atomic unit with backspace', () => {
    const big = 'x'.repeat(500);
    let state = insertText(createInputEditor(), 'before ');
    state = insertText(state, big);
    state = insertText(state, ' after');
    const withPlaceholder = state.value;
    expect(withPlaceholder).toContain('before [');
    expect(withPlaceholder).toContain('] after');

    // Move cursor to just after the placeholder, then backspace once.
    const placeholderEnd = withPlaceholder.indexOf('] after') + 1;
    state = {...state, cursor: placeholderEnd};
    state = applyEdit(state, 'backspace');
    expect(state.value).toBe('before  after');

    const result = submit(state);
    expect(result.submitted).toEqual({text: 'before  after', images: []});
  });

  it('inserts and expands an image reference placeholder, and surfaces the path in submitted.images', () => {
    const state = insertImagePlaceholder(createInputEditor(), '/tmp/screenshot.png');
    expect(state.value).toBe('[image attached #1: screenshot.png]');
    const result = submit(state);
    expect(result.submitted).toEqual({text: '(attached image: /tmp/screenshot.png)', images: ['/tmp/screenshot.png']});
  });

  it('auto-detects a pasted path to an existing image file', () => {
    const path = join(tmpdir(), `ateam-editor-test-${Date.now()}.png`);
    writeFileSync(path, Buffer.from([0]));
    tempFiles.push(path);

    const state = insertText(createInputEditor(), path);
    expect(state.value).toBe(`[image attached #1: ${path.split(/[\\/]/).pop()}]`);
    const result = submit(state);
    expect(result.submitted).toEqual({text: `(attached image: ${path})`, images: [path]});
  });

  it('drops an image from submitted.images if its placeholder was deleted before submit', () => {
    let state = insertImagePlaceholder(createInputEditor(), '/tmp/screenshot.png');
    state = applyEdit(state, 'backspace');
    expect(state.value).toBe('');
    const result = submit(state);
    expect(result.submitted).toBeUndefined();
  });

  it('collects multiple attached images in order', () => {
    let state = insertImagePlaceholder(createInputEditor(), '/tmp/a.png');
    state = insertText(state, ' and ');
    state = insertImagePlaceholder(state, '/tmp/b.png');
    const result = submit(state);
    expect(result.submitted?.images).toEqual(['/tmp/a.png', '/tmp/b.png']);
  });

  it('does not treat a nonexistent image-like path as an attachment', () => {
    const state = insertText(createInputEditor(), '/definitely/not/a/real/path.png');
    expect(state.value).toBe('/definitely/not/a/real/path.png');
  });

  it('does not wipe fresh draft text when navigating history forward', () => {
    let state = insertText(createInputEditor(), 'first');
    state = submit(state).state;
    state = insertText(state, 'fresh draft');
    state = applyEdit(state, 'historyNext');
    expect(state.value).toBe('fresh draft');
  });

  it('supports delete, home, end, and word navigation', () => {
    let state = insertText(createInputEditor(), 'alpha beta\ngamma');
    state = applyEdit(state, 'wordLeft');
    expect(state.cursor).toBe(11);
    state = applyEdit(state, 'home');
    expect(state.cursor).toBe(11);
    state = applyEdit(state, 'end');
    expect(state.cursor).toBe(16);
    state = applyEdit(state, 'wordLeft');
    state = applyEdit(state, 'delete');
    expect(state.value).toBe('alpha beta\namma');
  });

  it('cycles through multiple history entries and preserves whitespace-only drafts', () => {
    let state = submit(insertText(createInputEditor(), 'one')).state;
    state = submit(insertText(state, 'two')).state;
    state = applyEdit(state, 'historyPrev');
    expect(state.value).toBe('two');
    state = applyEdit(state, 'historyPrev');
    expect(state.value).toBe('one');
    state = applyEdit(state, 'historyNext');
    expect(state.value).toBe('two');
    const blank = submit(insertText(createInputEditor(), '   '));
    expect(blank.submitted).toBeUndefined();
  });
});
