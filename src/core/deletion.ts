import {
  findNextGraphemeBoundary,
  findNextWordBoundary,
  findPreviousGraphemeBoundary,
  findPreviousWordBoundary,
} from "./segmentation.js";
import { selectionMax, selectionMin, spliceText } from "./range-text.js";
import type { EditContextState, EditContextTransition } from "./types.js";

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
    // No-op delete still clamps an out-of-bounds cursor to text.length.
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

  // Chrome preserves original selectionStart for backward selections, even
  // when it is beyond the new text length.
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
