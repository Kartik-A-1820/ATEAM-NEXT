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
});
