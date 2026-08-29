import {describe, expect, it} from 'vitest';
import {applyEdit, createInputEditor, insertText, submit} from './editor.js';

describe('input editor', () => {
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
    expect(result.submitted).toBe('line one\nline two');
    const recalled = applyEdit(result.state, 'historyPrev');
    expect(recalled.value).toBe('line one\nline two');
  });

  it('handles large multiline paste as one insertion', () => {
    const paste = Array.from({length: 250}, (_, index) => `line ${index} with unicode ${index % 2 === 0 ? '✅' : 'नमस्ते'}`).join('\n');
    const state = insertText(createInputEditor(), paste);
    expect(state.value).toBe(paste);
    expect(state.cursor).toBe(Array.from(paste).length);
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
