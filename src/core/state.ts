import type { EditContextState, EditContextStateInit } from "./types.js";

export function createState(init: EditContextStateInit = {}): EditContextState {
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

export function clearComposition(state: EditContextState): EditContextState {
  return {
    ...state,
    composing: false,
    compositionSuspended: false,
    compositionRangeStart: 0,
    compositionRangeEnd: 0,
  };
}
