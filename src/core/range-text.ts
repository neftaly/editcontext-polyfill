import type { EditContextState } from "./types.js";

export function spliceText(text: string, start: number, end: number, insert: string): string {
  return text.substring(0, start) + insert + text.substring(end);
}

export function normalizeUpdateRange(
  text: string,
  rangeStart: number,
  rangeEnd: number,
): [start: number, end: number] {
  let start = rangeStart;
  let end = rangeEnd;
  if (start > end) {
    const tmp = start;
    start = end;
    end = tmp;
  }
  end = Math.min(end, text.length);
  start = Math.min(start, end);
  return [start, end];
}

export function selectionMin(state: EditContextState): number {
  return Math.min(state.selectionStart, state.selectionEnd);
}

export function selectionMax(state: EditContextState): number {
  return Math.max(state.selectionStart, state.selectionEnd);
}
