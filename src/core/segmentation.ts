// Intl.Segmenter instances are stateless for a given locale and granularity,
// so reuse them to avoid repeated ICU locale resolution.
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const WORD_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "word" });

export function findPreviousGraphemeBoundary(text: string, offset: number): number {
  if (offset <= 0) return 0;
  let lastBoundary = 0;
  for (const { index } of GRAPHEME_SEGMENTER.segment(text)) {
    if (index >= offset) break;
    lastBoundary = index;
  }
  return lastBoundary;
}

export function findNextGraphemeBoundary(text: string, offset: number): number {
  if (offset >= text.length) return text.length;
  for (const { index, segment } of GRAPHEME_SEGMENTER.segment(text)) {
    const end = index + segment.length;
    if (end > offset) return end;
  }
  return text.length;
}

// Chrome's Ctrl+Backspace: skip whitespace/punctuation, delete preceding word.
export function findPreviousWordBoundary(text: string, offset: number): number {
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
export function findNextWordBoundary(text: string, offset: number): number {
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
