export interface InputEditorState {
  value: string;
  cursor: number;
  history: string[];
  historyIndex?: number;
}

export function createInputEditor(): InputEditorState {
  return {value: '', cursor: 0, history: []};
}

export type EditKey =
  | 'left'
  | 'right'
  | 'home'
  | 'end'
  | 'backspace'
  | 'delete'
  | 'wordLeft'
  | 'wordRight'
  | 'historyPrev'
  | 'historyNext'
  | 'newline';

export function insertText(state: InputEditorState, text: string): InputEditorState {
  const chars = charsOf(state.value);
  const inserted = charsOf(text);
  chars.splice(state.cursor, 0, ...inserted);
  return {...state, value: chars.join(''), cursor: state.cursor + inserted.length, historyIndex: undefined};
}

export function applyEdit(state: InputEditorState, key: EditKey): InputEditorState {
  switch (key) {
    case 'left':
      return {...state, cursor: Math.max(0, state.cursor - 1)};
    case 'right':
      return {...state, cursor: Math.min(charsOf(state.value).length, state.cursor + 1)};
    case 'home':
      return {...state, cursor: lineStart(state.value, state.cursor)};
    case 'end':
      return {...state, cursor: lineEnd(state.value, state.cursor)};
    case 'backspace':
      if (state.cursor === 0) return state;
      return removeAt(state, state.cursor - 1);
    case 'delete':
      if (state.cursor >= charsOf(state.value).length) return state;
      return removeAt(state, state.cursor);
    case 'wordLeft':
      return {...state, cursor: previousWord(state.value, state.cursor)};
    case 'wordRight':
      return {...state, cursor: nextWord(state.value, state.cursor)};
    case 'historyPrev':
      return historyMove(state, -1);
    case 'historyNext':
      return historyMove(state, 1);
    case 'newline':
      return insertText(state, '\n');
    default:
      return state;
  }
}

export function submit(state: InputEditorState): {state: InputEditorState; submitted?: string} {
  const text = state.value;
  if (text.trim().length === 0) {
    return {state};
  }
  return {
    submitted: text,
    state: {value: '', cursor: 0, history: [...state.history, text].slice(-100), historyIndex: undefined},
  };
}

function lineStart(value: string, cursor: number): number {
  const chars = charsOf(value);
  for (let i = Math.max(0, cursor - 1); i >= 0; i--) {
    if (chars[i] === '\n') return i + 1;
  }
  return 0;
}

function lineEnd(value: string, cursor: number): number {
  const chars = charsOf(value);
  const index = chars.indexOf('\n', cursor);
  return index === -1 ? chars.length : index;
}

function previousWord(value: string, cursor: number): number {
  const valueChars = charsOf(value);
  let i = Math.max(0, cursor - 1);
  while (i > 0 && /\s/.test(valueChars[i] ?? '')) i--;
  while (i > 0 && !/\s/.test(valueChars[i - 1] ?? '')) i--;
  return i;
}

function nextWord(value: string, cursor: number): number {
  const valueChars = charsOf(value);
  let i = cursor;
  while (i < valueChars.length && !/\s/.test(valueChars[i] ?? '')) i++;
  while (i < valueChars.length && /\s/.test(valueChars[i] ?? '')) i++;
  return i;
}

function historyMove(state: InputEditorState, direction: -1 | 1): InputEditorState {
  if (state.history.length === 0) return state;
  if (state.historyIndex === undefined && direction === 1) return state;
  const current = state.historyIndex ?? state.history.length;
  const next = Math.max(0, Math.min(state.history.length, current + direction));
  if (next === state.history.length) {
    return {...state, value: '', cursor: 0, historyIndex: undefined};
  }
  const value = state.history[next];
  return {...state, value, cursor: charsOf(value).length, historyIndex: next};
}

function charsOf(value: string): string[] {
  return Array.from(value);
}

function removeAt(state: InputEditorState, index: number): InputEditorState {
  const chars = charsOf(state.value);
  chars.splice(index, 1);
  return {...state, value: chars.join(''), cursor: Math.min(index, chars.length)};
}
