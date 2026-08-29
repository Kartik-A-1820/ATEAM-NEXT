import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {applyEdit, createInputEditor, insertText, submit} from '../input/editor.js';

interface Props {
  onSubmit: (value: string) => void;
  disabled?: boolean;
}

export function InputBox({onSubmit, disabled = false}: Props) {
  const [editor, setEditor] = useState(createInputEditor);

  useInput((input, key) => {
    if (disabled) return;
    if (key.ctrl && input === 'c') {
      return;
    }
    if (key.return && key.shift) {
      setEditor(current => applyEdit(current, 'newline'));
      return;
    }
    if (key.return) {
      setEditor(current => {
        const result = submit(current);
        if (result.submitted) {
          onSubmit(result.submitted);
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
    else if (input) setEditor(current => insertText(current, input));
  });

  const chars = Array.from(editor.value);
  const before = chars.slice(0, editor.cursor).join('');
  const cursorChar = chars[editor.cursor] ?? ' ';
  const after = chars.slice(editor.cursor + 1).join('');

  return (
    <Box borderStyle="single" paddingX={1} minHeight={3} flexDirection="column">
      <Text>
        <Text color="green">{'>'} </Text>
        <Text>{before}</Text>
        <Text inverse>{cursorChar}</Text>
        <Text>{after}</Text>
      </Text>
    </Box>
  );
}
