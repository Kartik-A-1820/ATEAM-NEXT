import {existsSync} from 'node:fs';
import {basename} from 'node:path';

export interface InputEditorState {
  value: string;
  cursor: number;
  history: string[];
  historyIndex?: number;
  /** Placeholder text (e.g. "[4000 chars pasted #1]") -> the real text it expands to at submit time. */
  pastes: Record<string, string>;
  /** Placeholder text -> raw absolute image path, for placeholders that are image attachments.
   * A subset of pastes' keys — every image placeholder is also in pastes (with a textual fallback
   * expansion), so an adapter without real image support still gets a path mentioned in the text. */
  images: Record<string, string>;
  pasteCounter: number;
}

export interface SubmitResult {
  text: string;
  images: string[];
}

export function createInputEditor(): InputEditorState {
  return {value: '', cursor: 0, history: [], pastes: {}, images: {}, pasteCounter: 0};
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

/** Long pastes collapse to a short placeholder instead of flooding the input line. */
const PASTE_COMPACT_THRESHOLD = 400;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

export function insertText(state: InputEditorState, text: string): InputEditorState {
  const imagePath = detectImagePath(text);
  if (imagePath) {
    return insertPlaceholder(state, `[image attached #${state.pasteCounter + 1}: ${basename(imagePath)}]`, `(attached image: ${imagePath})`, imagePath);
  }
  const inserted = charsOf(text);
  if (inserted.length > PASTE_COMPACT_THRESHOLD) {
    return insertPlaceholder(state, `[${inserted.length.toLocaleString()} chars pasted #${state.pasteCounter + 1}]`, text);
  }
  const chars = charsOf(state.value);
  chars.splice(state.cursor, 0, ...inserted);
  return {...state, value: chars.join(''), cursor: state.cursor + inserted.length, historyIndex: undefined};
}

/** Inserts an image reference placeholder at the cursor, e.g. from a clipboard-image capture. */
export function insertImagePlaceholder(state: InputEditorState, imagePath: string): InputEditorState {
  return insertPlaceholder(state, `[image attached #${state.pasteCounter + 1}: ${basename(imagePath)}]`, `(attached image: ${imagePath})`, imagePath);
}

function insertPlaceholder(state: InputEditorState, placeholder: string, expansion: string, imagePath?: string): InputEditorState {
  const chars = charsOf(state.value);
  const placeholderChars = charsOf(placeholder);
  chars.splice(state.cursor, 0, ...placeholderChars);
  return {
    ...state,
    value: chars.join(''),
    cursor: state.cursor + placeholderChars.length,
    historyIndex: undefined,
    pastes: {...state.pastes, [placeholder]: expansion},
    images: imagePath === undefined ? state.images : {...state.images, [placeholder]: imagePath},
    pasteCounter: state.pasteCounter + 1,
  };
}

function detectImagePath(text: string): string | undefined {
  const trimmed = text.trim().replace(/^['"]|['"]$/g, '');
  if (trimmed.length === 0 || trimmed.includes('\n') || trimmed.length > 1000) return undefined;
  const dot = trimmed.lastIndexOf('.');
  if (dot === -1 || !IMAGE_EXTENSIONS.has(trimmed.slice(dot).toLowerCase())) return undefined;
  if (!existsSync(trimmed)) return undefined;
  return trimmed;
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
    case 'backspace': {
      if (state.cursor === 0) return state;
      const placeholder = placeholderEndingAt(state, state.cursor);
      if (placeholder) return removeRange(state, state.cursor - charsOf(placeholder).length, state.cursor, placeholder);
      return removeAt(state, state.cursor - 1);
    }
    case 'delete': {
      if (state.cursor >= charsOf(state.value).length) return state;
      const placeholder = placeholderStartingAt(state, state.cursor);
      if (placeholder) return removeRange(state, state.cursor, state.cursor + charsOf(placeholder).length, placeholder);
      return removeAt(state, state.cursor);
    }
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

/** A pasted block (long text or an image reference) deletes as one atomic unit, not char by char. */
function placeholderEndingAt(state: InputEditorState, endExclusive: number): string | undefined {
  const valueChars = charsOf(state.value);
  for (const key of Object.keys(state.pastes)) {
    const keyChars = charsOf(key);
    const start = endExclusive - keyChars.length;
    if (start >= 0 && valueChars.slice(start, endExclusive).join('') === key) return key;
  }
  return undefined;
}

function placeholderStartingAt(state: InputEditorState, start: number): string | undefined {
  const valueChars = charsOf(state.value);
  for (const key of Object.keys(state.pastes)) {
    const keyChars = charsOf(key);
    if (valueChars.slice(start, start + keyChars.length).join('') === key) return key;
  }
  return undefined;
}

export function submit(state: InputEditorState): {state: InputEditorState; submitted?: SubmitResult} {
  const expanded = expandPastes(state.value, state.pastes);
  if (expanded.trim().length === 0) {
    return {state};
  }
  const images = Object.entries(state.images)
    .filter(([placeholder]) => state.value.includes(placeholder))
    .map(([, path]) => path);
  return {
    submitted: {text: expanded, images},
    state: {value: '', cursor: 0, history: [...state.history, expanded].slice(-100), historyIndex: undefined, pastes: {}, images: {}, pasteCounter: 0},
  };
}

function expandPastes(value: string, pastes: Record<string, string>): string {
  let result = value;
  for (const [placeholder, expansion] of Object.entries(pastes)) {
    result = result.split(placeholder).join(expansion);
  }
  return result;
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

function removeRange(state: InputEditorState, from: number, to: number, removedPlaceholder?: string): InputEditorState {
  const chars = charsOf(state.value);
  chars.splice(from, to - from);
  const pastes = state.pastes;
  const nextPastes = removedPlaceholder && removedPlaceholder in pastes
    ? Object.fromEntries(Object.entries(pastes).filter(([key]) => key !== removedPlaceholder))
    : pastes;
  const images = state.images;
  const nextImages = removedPlaceholder && removedPlaceholder in images
    ? Object.fromEntries(Object.entries(images).filter(([key]) => key !== removedPlaceholder))
    : images;
  return {...state, value: chars.join(''), cursor: from, pastes: nextPastes, images: nextImages};
}
