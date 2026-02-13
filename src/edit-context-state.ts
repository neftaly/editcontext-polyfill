// Pure state transitions for EditContext.
// Each function takes immutable state and returns new state + effects.
// No DOM, no EventTarget, no side effects — pure data transformations.

// --- State & effect types ---

export interface EditContextState {
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly composing: boolean;
  /** When true, the composition is "suspended" — non-IME input arrived during
   *  an active composition.  Chrome keeps the composition range intact but
   *  updateSelection no longer cancels it.  A subsequent imeSetComposition
   *  resumes the composition (no extra compositionstart). */
  readonly compositionSuspended: boolean;
  readonly compositionRangeStart: number;
  readonly compositionRangeEnd: number;
}

export type EditContextEffect =
  | {
      readonly type: "textupdate";
      readonly text: string;
      readonly updateRangeStart: number;
      readonly updateRangeEnd: number;
      readonly selectionStart: number;
      readonly selectionEnd: number;
    }
  | { readonly type: "compositionstart"; readonly data: string }
  | { readonly type: "compositionend"; readonly data: string };

export interface EditContextTransition {
  readonly state: EditContextState;
  readonly effects: readonly EditContextEffect[];
}

// --- State constructor ---

export function createState(
  init: { text?: string; selectionStart?: number; selectionEnd?: number } = {},
): EditContextState {
  const text = init.text ?? "";
  const len = text.length;
  return {
    text,
    selectionStart: Math.min(init.selectionStart ?? 0, len),
    selectionEnd: Math.min(init.selectionEnd ?? 0, len),
    composing: false,
    compositionSuspended: false,
    compositionRangeStart: 0,
    compositionRangeEnd: 0,
  };
}

// --- Pure text utilities ---

function spliceText(text: string, start: number, end: number, insert: string): string {
  return text.substring(0, start) + insert + text.substring(end);
}

// Intl.Segmenter instances are stateless for a given locale+granularity,
// so we reuse them to avoid repeated ICU locale resolution.
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const WORD_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "word" });

function findPreviousGraphemeBoundary(text: string, offset: number): number {
  if (offset <= 0) return 0;
  let lastBoundary = 0;
  for (const { index } of GRAPHEME_SEGMENTER.segment(text)) {
    if (index >= offset) break;
    lastBoundary = index;
  }
  return lastBoundary;
}

function findNextGraphemeBoundary(text: string, offset: number): number {
  if (offset >= text.length) return text.length;
  for (const { index, segment } of GRAPHEME_SEGMENTER.segment(text)) {
    const end = index + segment.length;
    if (end > offset) return end;
  }
  return text.length;
}

// Chrome's Ctrl+Backspace: skip whitespace/punctuation, delete preceding word.
function findPreviousWordBoundary(text: string, offset: number): number {
  if (offset <= 0) return 0;
  let lastWordStart = 0;
  let currentWordStart = -1;
  for (const seg of WORD_SEGMENTER.segment(text)) {
    if (seg.index >= offset) break;
    if (seg.isWordLike) {
      if (seg.index + seg.segment.length >= offset) {
        currentWordStart = seg.index;
      } else {
        lastWordStart = seg.index;
      }
    }
  }
  if (currentWordStart >= 0 && currentWordStart < offset) return currentWordStart;
  return lastWordStart;
}

// Chrome's Ctrl+Delete: skip whitespace/punctuation, delete following word.
function findNextWordBoundary(text: string, offset: number): number {
  if (offset >= text.length) return text.length;
  let passedOffset = false;
  for (const seg of WORD_SEGMENTER.segment(text)) {
    const segEnd = seg.index + seg.segment.length;
    if (!passedOffset) {
      if (segEnd <= offset) continue;
      if (seg.isWordLike) return segEnd;
      passedOffset = true;
      continue;
    }
    if (seg.isWordLike) return seg.index + seg.segment.length;
  }
  return text.length;
}

// --- Helpers ---

function selectionMin(state: EditContextState): number {
  return Math.min(state.selectionStart, state.selectionEnd);
}

function selectionMax(state: EditContextState): number {
  return Math.max(state.selectionStart, state.selectionEnd);
}

function clearComposition(state: EditContextState): EditContextState {
  return {
    ...state,
    composing: false,
    compositionSuspended: false,
    compositionRangeStart: 0,
    compositionRangeEnd: 0,
  };
}

// --- Transitions ---

// Chrome's EditContext::updateText — changes text only, no events, no selection adjustment.
export function updateText(
  state: EditContextState,
  rangeStart: number,
  rangeEnd: number,
  newText: string,
): EditContextTransition {
  let start = rangeStart;
  let end = rangeEnd;
  if (start > end) {
    const tmp = start;
    start = end;
    end = tmp;
  }
  end = Math.min(end, state.text.length);
  start = Math.min(start, end);

  return {
    state: { ...state, text: spliceText(state.text, start, end, newText) },
    effects: [],
  };
}

// Chrome's EditContext::updateSelection — may cancel active composition.
export function updateSelection(
  state: EditContextState,
  start: number,
  end: number,
): EditContextTransition {
  let current = state;
  const effects: EditContextEffect[] = [];

  let boundStart = Math.min(start, current.text.length);
  let boundEnd = Math.min(end, current.text.length);

  // Only cancel composition if it is actively composing (not suspended).
  // When suspended (non-IME input arrived during composition), Chrome keeps
  // the composition range intact and updateSelection does NOT cancel it.
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

// Chrome's SetComposition — starts or continues IME composition.
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
    // Resume a suspended composition — no compositionstart, just clear the
    // suspended flag so the composition continues as if it was never interrupted.
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

// Chrome's CommitText — finalize composition or insert at selection.
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

// Chrome's InsertText — non-IME text insertion at selection.
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

// Chrome's OnCancelComposition — remove composed text, fire compositionend.
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

// Suspend an active composition — marks it as "suspended" so that
// updateSelection won't cancel it, but the composition range is kept.
// Used when non-IME input arrives during an active composition (Chrome
// silently keeps the composition range intact in this case).
export function suspendComposition(state: EditContextState): EditContextState {
  if (!state.composing || state.compositionSuspended) return state;
  return { ...state, compositionSuspended: true };
}

// Chrome's FinishComposingText — commit in-place (blur/focus change).
export function finishComposingText(
  state: EditContextState,
  keepSelection: boolean,
): EditContextTransition {
  if (!state.composing) return { state: clearComposition(state), effects: [] };

  const composedText = state.text.substring(state.compositionRangeStart, state.compositionRangeEnd);
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

// Generic delete with selection expansion for collapsed selections.
function deleteWithExpansion(
  state: EditContextState,
  expandSelection: (text: string, pos: number) => [start: number, end: number],
): EditContextTransition {
  const origSelStart = state.selectionStart;
  const wasBackward = state.selectionStart > state.selectionEnd;
  let current = state;

  if (current.selectionStart === current.selectionEnd) {
    const bounded = Math.min(current.selectionStart, current.text.length);
    const [expandedStart, expandedEnd] = expandSelection(current.text, bounded);
    current = { ...current, selectionStart: expandedStart, selectionEnd: expandedEnd };
  }

  if (current.selectionStart === current.selectionEnd) {
    // No-op delete: nothing to remove. Chrome still clamps an out-of-bounds
    // selection to text.length (e.g. deleteWordForward when cursor is beyond
    // text length after updateText shrank the text).
    const clampedSel = Math.min(current.selectionStart, current.text.length);
    if (clampedSel !== state.selectionStart || clampedSel !== state.selectionEnd) {
      return {
        state: { ...state, selectionStart: clampedSel, selectionEnd: clampedSel },
        effects: [],
      };
    }
    return { state, effects: [] };
  }

  const deleteStart = selectionMin(current);
  const deleteEnd = selectionMax(current);
  const newText = spliceText(current.text, deleteStart, deleteEnd, "");

  // Chrome keeps the original selectionStart for backward selections even when
  // it ends up beyond the new text length. It does NOT clamp to newText.length.
  const finalSel = wasBackward ? origSelStart : deleteStart;

  return {
    state: { ...current, text: newText, selectionStart: finalSel, selectionEnd: finalSel },
    effects: [
      {
        type: "textupdate",
        text: "",
        updateRangeStart: deleteStart,
        updateRangeEnd: deleteEnd,
        selectionStart: deleteStart,
        selectionEnd: deleteStart,
      },
    ],
  };
}

export function deleteBackward(state: EditContextState): EditContextTransition {
  return deleteWithExpansion(state, (text, pos) => [findPreviousGraphemeBoundary(text, pos), pos]);
}

export function deleteForward(state: EditContextState): EditContextTransition {
  return deleteWithExpansion(state, (text, pos) => [pos, findNextGraphemeBoundary(text, pos)]);
}

export function deleteWordBackward(state: EditContextState): EditContextTransition {
  return deleteWithExpansion(state, (text, pos) => [findPreviousWordBoundary(text, pos), pos]);
}

export function deleteWordForward(state: EditContextState): EditContextTransition {
  return deleteWithExpansion(state, (text, pos) => [pos, findNextWordBoundary(text, pos)]);
}
