import { normalizeUpdateRange, selectionMax, selectionMin, spliceText } from "./range-text.js";
import { clearComposition } from "./state.js";
import type { EditContextEffect, EditContextState, EditContextTransition } from "./types.js";

// Chrome's EditContext::updateText: changes text only, no events, no selection adjustment.
export function updateText(
  state: EditContextState,
  rangeStart: number,
  rangeEnd: number,
  newText: string,
): EditContextTransition {
  const [start, end] = normalizeUpdateRange(state.text, rangeStart, rangeEnd);

  return {
    state: { ...state, text: spliceText(state.text, start, end, newText) },
    effects: [],
  };
}

// Chrome's EditContext::updateSelection: may cancel active composition.
export function updateSelection(
  state: EditContextState,
  start: number,
  end: number,
): EditContextTransition {
  let current = state;
  const effects: EditContextEffect[] = [];

  let boundStart = Math.min(start, current.text.length);
  let boundEnd = Math.min(end, current.text.length);

  if (
    current.composing &&
    !current.compositionSuspended &&
    (boundStart !== current.selectionStart || boundEnd !== current.selectionEnd)
  ) {
    const cancel = cancelComposition(current);
    current = cancel.state;
    effects.push(...cancel.effects);
    boundStart = Math.min(start, current.text.length);
    boundEnd = Math.min(end, current.text.length);
  }

  current = { ...current, selectionStart: boundStart, selectionEnd: boundEnd };

  if (
    current.composing &&
    current.compositionRangeStart === 0 &&
    current.compositionRangeEnd === 0
  ) {
    current = {
      ...current,
      compositionRangeStart: selectionMin(current),
      compositionRangeEnd: selectionMax(current),
    };
  }

  return { state: current, effects };
}

// Chrome's SetComposition: starts, resumes, or continues IME composition.
export function setComposition(
  state: EditContextState,
  text: string,
  selStart: number,
  selEnd: number,
): EditContextTransition {
  const effects: EditContextEffect[] = [];
  let current = state;

  if (text !== "" && !current.composing) {
    effects.push({ type: "compositionstart", data: text });
    current = { ...current, composing: true, compositionSuspended: false };
  } else if (text !== "" && current.compositionSuspended) {
    current = { ...current, compositionSuspended: false };
  }

  if (text === "") {
    if (current.composing) {
      const cancel = cancelComposition(current);
      return { state: cancel.state, effects: [...effects, ...cancel.effects] };
    }
    return { state: current, effects };
  }

  let replaceStart: number;
  let replaceEnd: number;
  if (current.compositionRangeStart === 0 && current.compositionRangeEnd === 0) {
    replaceStart = selectionMin(current);
    replaceEnd = selectionMax(current);
  } else {
    replaceStart = current.compositionRangeStart;
    replaceEnd = current.compositionRangeEnd;
  }

  const newText = spliceText(current.text, replaceStart, replaceEnd, text);
  const newSelStart = replaceStart + selStart;
  const newSelEnd = replaceStart + selEnd;

  effects.push({
    type: "textupdate",
    text,
    updateRangeStart: replaceStart,
    updateRangeEnd: replaceEnd,
    selectionStart: newSelStart,
    selectionEnd: newSelEnd,
  });

  return {
    state: {
      ...current,
      text: newText,
      selectionStart: newSelStart,
      selectionEnd: newSelEnd,
      compositionRangeStart: replaceStart,
      compositionRangeEnd: replaceStart + text.length,
    },
    effects,
  };
}

// Chrome's CommitText: finalize composition or insert at selection.
export function commitText(state: EditContextState, text: string): EditContextTransition {
  const effects: EditContextEffect[] = [];

  let replaceStart: number;
  let replaceEnd: number;
  if (state.composing) {
    replaceStart = state.compositionRangeStart;
    replaceEnd = state.compositionRangeEnd;
  } else {
    replaceStart = selectionMin(state);
    replaceEnd = selectionMax(state);
  }

  const newText = spliceText(state.text, replaceStart, replaceEnd, text);
  const newSel = replaceStart + text.length;

  effects.push({
    type: "textupdate",
    text,
    updateRangeStart: replaceStart,
    updateRangeEnd: replaceEnd,
    selectionStart: newSel,
    selectionEnd: newSel,
  });

  if (text !== "" && state.composing) {
    effects.push({ type: "compositionend", data: text });
  }

  return {
    state: {
      text: newText,
      selectionStart: newSel,
      selectionEnd: newSel,
      composing: false,
      compositionSuspended: false,
      compositionRangeStart: 0,
      compositionRangeEnd: 0,
    },
    effects,
  };
}

// Chrome's InsertText: non-IME text insertion at selection.
export function insertText(state: EditContextState, text: string): EditContextTransition {
  const start = selectionMin(state);
  const end = selectionMax(state);
  const newText = spliceText(state.text, start, end, text);
  const newSel = start + text.length;

  return {
    state: { ...state, text: newText, selectionStart: newSel, selectionEnd: newSel },
    effects: [
      {
        type: "textupdate",
        text,
        updateRangeStart: start,
        updateRangeEnd: end,
        selectionStart: newSel,
        selectionEnd: newSel,
      },
    ],
  };
}

// Chrome's OnCancelComposition: remove composed text, fire compositionend.
export function cancelComposition(state: EditContextState): EditContextTransition {
  if (!state.composing) return { state, effects: [] };

  const newText = spliceText(
    state.text,
    state.compositionRangeStart,
    state.compositionRangeEnd,
    "",
  );
  const newSel = state.compositionRangeStart;

  return {
    state: {
      text: newText,
      selectionStart: newSel,
      selectionEnd: newSel,
      composing: false,
      compositionSuspended: false,
      compositionRangeStart: 0,
      compositionRangeEnd: 0,
    },
    effects: [
      {
        type: "textupdate",
        text: "",
        updateRangeStart: state.compositionRangeStart,
        updateRangeEnd: state.compositionRangeEnd,
        selectionStart: newSel,
        selectionEnd: newSel,
      },
      { type: "compositionend", data: "" },
    ],
  };
}

export function suspendComposition(state: EditContextState): EditContextState {
  if (!state.composing || state.compositionSuspended) return state;
  return { ...state, compositionSuspended: true };
}

// Chrome's FinishComposingText: commit in-place on blur/focus change.
export function finishComposingText(
  state: EditContextState,
  keepSelection: boolean,
  explicitData?: string,
): EditContextTransition {
  if (!state.composing) return { state: clearComposition(state), effects: [] };

  const composedText =
    explicitData ?? state.text.substring(state.compositionRangeStart, state.compositionRangeEnd);
  const effects: EditContextEffect[] = [{ type: "compositionend", data: composedText }];

  let current = state;
  if (!keepSelection) {
    const textLength = current.compositionRangeEnd - current.compositionRangeStart;
    current = {
      ...current,
      selectionStart: current.selectionStart + textLength,
      selectionEnd: current.selectionEnd + textLength,
    };
  }

  return { state: clearComposition(current), effects };
}
