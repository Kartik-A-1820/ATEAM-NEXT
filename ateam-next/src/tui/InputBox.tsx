import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {completeSlashInput, slashAutocomplete} from '../commands/registry.js';
import {applyEdit, createInputEditor, insertImagePlaceholder, insertText, submit, type SubmitResult} from '../input/editor.js';
import {captureClipboardImage} from '../input/clipboardImage.js';

interface Props {
  onSubmit: (value: SubmitResult) => void;
  disabled?: boolean;
  placeholder?: string;
  running?: boolean;
}

const PASTE_IMAGE_COMMAND = '/paste-image';

export function InputBox({onSubmit, disabled = false, placeholder, running = false}: Props) {
  const [editor, setEditor] = useState(createInputEditor);

  useInput((input, key) => {
    if (disabled) return;
    if (key.ctrl && input === 'c') {
      return;
    }
    if (key.tab) {
      if (!key.shift) {
        setEditor(current => {
          const completed = completeSlashInput(current.value);
          if (completed === undefined) return current;
          return {...current, value: completed, cursor: completed.length};
        });
      }
      return;
    }
    const submitIndex = firstSubmitIndex(input);
    if (submitIndex !== -1 && !key.shift) {
      const beforeSubmit = input.slice(0, submitIndex);
      setEditor(current => {
        const withChunk = beforeSubmit.length > 0 ? insertText(current, beforeSubmit) : current;
        const result = submit(withChunk);
        const submitted = result.submitted;
        if (submitted) {
          queueMicrotask(() => onSubmit(submitted));
        }
        return result.state;
      });
      return;
    }
    if (key.return && key.shift) {
      setEditor(current => applyEdit(current, 'newline'));
      return;
    }
    if (key.return) {
      if (editor.value.trim() === PASTE_IMAGE_COMMAND) {
        setEditor(current => ({...current, value: '', cursor: 0}));
        void captureClipboardImage().then(result => {
          setEditor(current => result.ok && result.path
            ? insertImagePlaceholder(current, result.path!)
            : insertText(current, `[image paste failed: ${result.reason ?? 'unknown error'}] `));
        });
        return;
      }
      setEditor(current => {
        const result = submit(current);
        const submitted = result.submitted;
        if (submitted) {
          queueMicrotask(() => onSubmit(submitted));
        }
        return result.state;
      });
      return;
    }
    if (key.leftArrow) setEditor(current => applyEdit(current, key.meta || key.ctrl ? 'wordLeft' : 'left'));
    else if (key.rightArrow) setEditor(current => applyEdit(current, key.meta || key.ctrl ? 'wordRight' : 'right'));
    else if (key.upArrow) setEditor(current => applyEdit(current, 'historyPrev'));
    else if (key.downArrow) setEditor(current => applyEdit(current, 'historyNext'));
    else if (key.home) setEditor(current => applyEdit(current, 'home'));
    else if (key.end) setEditor(current => applyEdit(current, 'end'));
    else if (key.backspace) setEditor(current => applyEdit(current, 'backspace'));
    else if (key.delete) setEditor(current => applyEdit(current, 'delete'));
    else if (input && !key.ctrl && !key.meta) setEditor(current => insertText(current, input));
  });

  const chars = Array.from(editor.value);
  const before = chars.slice(0, editor.cursor).join('');
  const cursorChar = chars[editor.cursor] ?? ' ';
  const after = chars.slice(editor.cursor + 1).join('');
  const idle = editor.value.length === 0;
  const suggestionText = slashAutocomplete(editor.value).suggestions.join('  ');

  return (
    <Box borderStyle="single" paddingX={1} minHeight={3} flexDirection="column" flexShrink={0}>
      <Text>
        <Text color="green">{'>'} </Text>
        {idle && placeholder ? <Text dimColor>{placeholder}</Text> : null}
        <Text>{before}</Text>
        <Text inverse>{cursorChar}</Text>
        <Text>{after}</Text>
      </Text>
      {idle ? (
        <Text dimColor>{running ? 'running…  ' : ''}shift+enter newline · /commands · /paste-image · tab cycle views</Text>
      ) : suggestionText ? (
        <Text dimColor>{suggestionText}</Text>
      ) : null}
    </Box>
  );
}

function firstSubmitIndex(input: string): number {
  const carriage = input.indexOf('\r');
  const newline = input.indexOf('\n');
  if (carriage === -1) return newline;
  if (newline === -1) return carriage;
  return Math.min(carriage, newline);
}
