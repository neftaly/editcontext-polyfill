import { test, expect } from "@playwright/test";
import {
  type EditContextState,
  type EditContextEffect,
  createState,
  updateText,
  updateSelection,
  setComposition,
  commitText,
  insertText,
  cancelComposition,
  finishComposingText,
  suspendComposition,
  deleteBackward,
  deleteForward,
  deleteWordBackward,
  deleteWordForward,
} from "../../src/edit-context-state.js";

// Extra edge-case and interaction tests — no browser needed, runs directly in Node.

// ============================================================
// 1. Composition + delete interactions
// ============================================================

test.describe("composition + delete interactions", () => {
  test("deleteBackward during active composition operates on text without cancelling composition", () => {
    // Start with "hello", compose "ka" at end => "helloka"
    let s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });
    s = setComposition(s, "ka", 2, 2).state;
    // s.text = "helloka", sel=7, composing=true, compRange=[5,7]

    // deleteBackward during composition: operates on the raw state
    const result = deleteBackward(s);
    // Should delete one grapheme before position 7 => deletes "a" (pos 6..7)
    expect(result.state.text).toBe("hellok");
    expect(result.state.selectionStart).toBe(6);
    expect(result.state.selectionEnd).toBe(6);
    // The composing flag is preserved (deleteWithExpansion does not touch it)
    expect(result.state.composing).toBe(true);
  });

  test("deleteForward during active composition operates on text without cancelling composition", () => {
    // Compose in the middle: "ab|cd" => compose "XY" at pos 2 => "abXYcd"
    let s = createState({ text: "abcd", selectionStart: 2, selectionEnd: 2 });
    s = setComposition(s, "XY", 2, 2).state;
    // s.text = "abXYcd", sel=4, composing=true, compRange=[2,4]

    // Move selection to position 4 (after composition), but that would cancel composition
    // Instead, test deleteForward from the current selection pos (4)
    const result = deleteForward(s);
    // Should delete "c" at pos 4 => "abXYd"
    expect(result.state.text).toBe("abXYd");
    expect(result.state.selectionStart).toBe(4);
    expect(result.state.selectionEnd).toBe(4);
    expect(result.state.composing).toBe(true);
  });

  test("deleteWordBackward during active composition", () => {
    let s = createState({ text: "hello world", selectionStart: 11, selectionEnd: 11 });
    s = setComposition(s, "test", 4, 4).state;
    // s.text = "hello worldtest", sel=15, composing=true, compRange=[11,15]

    const result = deleteWordBackward(s);
    // From pos 15, word boundary backward should find start of "worldtest" or "test"
    // The composed text is part of the string now, so word segmenter sees it
    expect(result.state.composing).toBe(true);
    expect(result.state.text.length).toBeLessThan(15);
  });

  test("deleteBackward with non-collapsed selection during composition deletes selection", () => {
    // Manually construct a composing state with a non-collapsed selection
    const s: EditContextState = {
      text: "abcXYdef",
      selectionStart: 3,
      selectionEnd: 5,
      composing: true,
      compositionSuspended: false,
      compositionRangeStart: 3,
      compositionRangeEnd: 5,
    };
    const result = deleteBackward(s);
    // Non-collapsed selection: deletes "XY" (positions 3..5)
    expect(result.state.text).toBe("abcdef");
    expect(result.state.selectionStart).toBe(3);
    expect(result.state.selectionEnd).toBe(3);
    // composing flag is preserved by deleteWithExpansion
    expect(result.state.composing).toBe(true);
  });
});

// ============================================================
// 2. updateText during composition
// ============================================================

test.describe("updateText during composition", () => {
  test("updateText does not affect composition state flags", () => {
    let s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });
    s = setComposition(s, "ka", 2, 2).state;
    // s.text = "helloka", composing=true, compRange=[5,7]

    // updateText replaces "llo" (pos 2..5) with "ZZ"
    const result = updateText(s, 2, 5, "ZZ");
    expect(result.state.text).toBe("heZZka");
    // composing, compositionRangeStart, compositionRangeEnd are unchanged
    expect(result.state.composing).toBe(true);
    expect(result.state.compositionRangeStart).toBe(5);
    expect(result.state.compositionRangeEnd).toBe(7);
    // selection is unchanged
    expect(result.state.selectionStart).toBe(7);
    expect(result.state.selectionEnd).toBe(7);
    // No effects emitted
    expect(result.effects).toEqual([]);
  });

  test("updateText can modify text within the composition range", () => {
    let s = createState({ text: "abc", selectionStart: 3, selectionEnd: 3 });
    s = setComposition(s, "XYZ", 3, 3).state;
    // s.text = "abcXYZ", composing=true, compRange=[3,6]

    // Replace "XY" with "W" inside the composition range
    const result = updateText(s, 3, 5, "W");
    expect(result.state.text).toBe("abcWZ");
    // compositionRangeEnd is NOT adjusted by updateText
    expect(result.state.compositionRangeStart).toBe(3);
    expect(result.state.compositionRangeEnd).toBe(6);
    expect(result.state.composing).toBe(true);
  });

  test("updateText with empty replacement during composition", () => {
    let s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });
    s = setComposition(s, "ab", 2, 2).state;
    // s.text = "helloab", compRange=[5,7]

    // Delete the composition text via updateText
    const result = updateText(s, 5, 7, "");
    expect(result.state.text).toBe("hello");
    // composing flag is still true -- updateText does not touch it
    expect(result.state.composing).toBe(true);
    expect(result.effects).toEqual([]);
  });
});

// ============================================================
// 3. Multiple sequential compositions
// ============================================================

test.describe("multiple sequential compositions", () => {
  test("setComposition -> commitText -> setComposition -> commitText", () => {
    let s = createState({ text: "", selectionStart: 0, selectionEnd: 0 });

    // First composition: type "ka" -> commit as hiragana
    let r = setComposition(s, "k", 1, 1);
    expect(r.effects[0].type).toBe("compositionstart");
    s = r.state;

    r = setComposition(s, "ka", 2, 2);
    s = r.state;
    expect(s.text).toBe("ka");

    r = commitText(s, "\u304B"); // commit か
    s = r.state;
    expect(s.text).toBe("\u304B");
    expect(s.composing).toBe(false);
    expect(s.selectionStart).toBe(1);
    expect(s.selectionEnd).toBe(1);

    // Second composition: type "na" -> commit as hiragana
    r = setComposition(s, "n", 1, 1);
    expect(r.effects[0].type).toBe("compositionstart");
    s = r.state;
    expect(s.text).toBe("\u304Bn");
    expect(s.composing).toBe(true);
    expect(s.compositionRangeStart).toBe(1);
    expect(s.compositionRangeEnd).toBe(2);

    r = setComposition(s, "na", 2, 2);
    s = r.state;
    expect(s.text).toBe("\u304Bna");
    expect(s.compositionRangeEnd).toBe(3);

    r = commitText(s, "\u306A"); // commit な
    s = r.state;
    expect(s.text).toBe("\u304B\u306A"); // かな
    expect(s.composing).toBe(false);
    expect(s.selectionStart).toBe(2);
    expect(s.selectionEnd).toBe(2);
  });

  test("three compositions in a row build up text correctly", () => {
    let s = createState();

    // Compose "A"
    s = setComposition(s, "A", 1, 1).state;
    s = commitText(s, "A").state;
    expect(s.text).toBe("A");

    // Compose "B"
    s = setComposition(s, "B", 1, 1).state;
    s = commitText(s, "B").state;
    expect(s.text).toBe("AB");

    // Compose "C"
    s = setComposition(s, "C", 1, 1).state;
    s = commitText(s, "C").state;
    expect(s.text).toBe("ABC");
    expect(s.selectionStart).toBe(3);
    expect(s.selectionEnd).toBe(3);
    expect(s.composing).toBe(false);
  });

  test("composition -> cancel -> new composition resumes cleanly", () => {
    let s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });

    // Start first composition
    s = setComposition(s, "ab", 2, 2).state;
    expect(s.text).toBe("helloab");

    // Cancel it
    s = cancelComposition(s).state;
    expect(s.text).toBe("hello");
    expect(s.composing).toBe(false);
    expect(s.selectionStart).toBe(5);

    // Start second composition at same position
    const r = setComposition(s, "cd", 2, 2);
    s = r.state;
    expect(s.text).toBe("hellocd");
    expect(s.composing).toBe(true);
    expect(s.compositionRangeStart).toBe(5);
    expect(s.compositionRangeEnd).toBe(7);
    // Should fire compositionstart again
    expect(r.effects[0].type).toBe("compositionstart");
  });
});

// ============================================================
// 4. setComposition with different selStart/selEnd values
// ============================================================

test.describe("setComposition with selection offsets", () => {
  test("selStart=0, selEnd=0 places cursor at start of composition", () => {
    const s = createState({ text: "abc", selectionStart: 3, selectionEnd: 3 });
    const result = setComposition(s, "XY", 0, 0);
    // selStart/selEnd are offsets within the composition text
    // newSelStart = replaceStart + selStart = 3 + 0 = 3
    // newSelEnd = replaceStart + selEnd = 3 + 0 = 3
    expect(result.state.selectionStart).toBe(3);
    expect(result.state.selectionEnd).toBe(3);
    expect(result.state.text).toBe("abcXY");
    expect(result.state.compositionRangeStart).toBe(3);
    expect(result.state.compositionRangeEnd).toBe(5);
  });

  test("selStart=1, selEnd=1 places cursor in middle of composition", () => {
    const s = createState({ text: "abc", selectionStart: 3, selectionEnd: 3 });
    const result = setComposition(s, "XYZ", 1, 1);
    expect(result.state.selectionStart).toBe(4); // 3 + 1
    expect(result.state.selectionEnd).toBe(4);
  });

  test("selStart != selEnd creates a selection within composition text", () => {
    const s = createState({ text: "abc", selectionStart: 3, selectionEnd: 3 });
    const result = setComposition(s, "WXYZ", 1, 3);
    // Cursor range within the composition: positions 1..3 of "WXYZ"
    expect(result.state.selectionStart).toBe(4); // 3 + 1
    expect(result.state.selectionEnd).toBe(6); // 3 + 3
    expect(result.state.text).toBe("abcWXYZ");

    // The textupdate effect reflects these selection offsets
    const textEffect = result.effects.find((e) => e.type === "textupdate") as Extract<
      EditContextEffect,
      { type: "textupdate" }
    >;
    expect(textEffect.selectionStart).toBe(4);
    expect(textEffect.selectionEnd).toBe(6);
  });

  test("selEnd at end of composition text", () => {
    const s = createState({ text: "", selectionStart: 0, selectionEnd: 0 });
    const result = setComposition(s, "hello", 5, 5);
    expect(result.state.selectionStart).toBe(5);
    expect(result.state.selectionEnd).toBe(5);
  });

  test("continuation composition preserves selStart/selEnd offsets", () => {
    let s = createState({ text: "pre", selectionStart: 3, selectionEnd: 3 });
    s = setComposition(s, "a", 1, 1).state;
    // Continue: "ab" with cursor before "b"
    const result = setComposition(s, "ab", 1, 1);
    // replaceStart is compositionRangeStart = 3
    expect(result.state.selectionStart).toBe(4); // 3 + 1
    expect(result.state.selectionEnd).toBe(4);
    expect(result.state.text).toBe("preab");
  });
});

// ============================================================
// 5. commitText with empty string during non-composing state
// ============================================================

test.describe("commitText with empty string (non-composing)", () => {
  test("empty commit on non-composing state with collapsed selection is effectively a no-op on text", () => {
    const s = createState({ text: "hello", selectionStart: 3, selectionEnd: 3 });
    const result = commitText(s, "");
    expect(result.state.text).toBe("hello");
    expect(result.state.selectionStart).toBe(3);
    expect(result.state.selectionEnd).toBe(3);
    expect(result.state.composing).toBe(false);
    // Should still emit textupdate (replacing empty range with empty string)
    expect(result.effects.length).toBe(1);
    expect(result.effects[0]).toEqual({
      type: "textupdate",
      text: "",
      updateRangeStart: 3,
      updateRangeEnd: 3,
      selectionStart: 3,
      selectionEnd: 3,
    });
  });

  test("empty commit on non-composing state with selection deletes the selection", () => {
    const s = createState({ text: "abcdef", selectionStart: 1, selectionEnd: 4 });
    const result = commitText(s, "");
    // replaceStart=1, replaceEnd=4, replacement=""
    expect(result.state.text).toBe("aef");
    expect(result.state.selectionStart).toBe(1);
    expect(result.state.selectionEnd).toBe(1);
    // No compositionend because not composing and text is empty
    expect(result.effects.length).toBe(1);
    expect(result.effects[0].type).toBe("textupdate");
  });

  test("empty commit on empty text with collapsed selection at 0", () => {
    const s = createState();
    const result = commitText(s, "");
    expect(result.state.text).toBe("");
    expect(result.state.selectionStart).toBe(0);
    expect(result.state.selectionEnd).toBe(0);
    expect(result.effects.length).toBe(1);
    expect(result.effects[0]).toEqual({
      type: "textupdate",
      text: "",
      updateRangeStart: 0,
      updateRangeEnd: 0,
      selectionStart: 0,
      selectionEnd: 0,
    });
  });
});

// ============================================================
// 6. finishComposingText with keepSelection=false at different positions
// ============================================================

test.describe("finishComposingText with keepSelection=false at different positions", () => {
  test("composition at start of text", () => {
    // Manually construct state: composition "AB" at start, then "cde" after
    const s: EditContextState = {
      text: "ABcde",
      selectionStart: 2,
      selectionEnd: 2,
      composing: true,
      compositionSuspended: false,
      compositionRangeStart: 0,
      compositionRangeEnd: 2,
    };
    const result = finishComposingText(s, false);
    expect(result.state.text).toBe("ABcde");
    expect(result.state.composing).toBe(false);
    // keepSelection=false: selection advances by composition length (2)
    expect(result.state.selectionStart).toBe(4); // 2 + 2
    expect(result.state.selectionEnd).toBe(4);
    expect(result.effects).toEqual([{ type: "compositionend", data: "AB" }]);
  });

  test("composition in the middle of text", () => {
    const s: EditContextState = {
      text: "helloWORLDend",
      selectionStart: 10,
      selectionEnd: 10,
      composing: true,
      compositionSuspended: false,
      compositionRangeStart: 5,
      compositionRangeEnd: 10,
    };
    const result = finishComposingText(s, false);
    expect(result.state.text).toBe("helloWORLDend");
    // composition length = 10 - 5 = 5
    expect(result.state.selectionStart).toBe(15); // 10 + 5
    expect(result.state.selectionEnd).toBe(15);
    expect(result.effects[0]).toEqual({ type: "compositionend", data: "WORLD" });
  });

  test("keepSelection=false with selection inside composition (not at end)", () => {
    // Selection is at position 2 within a composition range of [1, 5]
    const s: EditContextState = {
      text: "aXYZWb",
      selectionStart: 3,
      selectionEnd: 3,
      composing: true,
      compositionSuspended: false,
      compositionRangeStart: 1,
      compositionRangeEnd: 5,
    };
    const result = finishComposingText(s, false);
    // composition length = 5 - 1 = 4
    // selectionStart = 3 + 4 = 7, selectionEnd = 3 + 4 = 7
    expect(result.state.selectionStart).toBe(7);
    expect(result.state.selectionEnd).toBe(7);
    expect(result.state.composing).toBe(false);
  });

  test("keepSelection=true with composition at start preserves exact selection", () => {
    const s: EditContextState = {
      text: "ABcde",
      selectionStart: 2,
      selectionEnd: 2,
      composing: true,
      compositionSuspended: false,
      compositionRangeStart: 0,
      compositionRangeEnd: 2,
    };
    const result = finishComposingText(s, true);
    expect(result.state.selectionStart).toBe(2);
    expect(result.state.selectionEnd).toBe(2);
    expect(result.state.composing).toBe(false);
  });

  test("finishComposingText when not composing clears composition range", () => {
    // Not composing, but compositionRange might be stale from a manually constructed state
    const s: EditContextState = {
      text: "abc",
      selectionStart: 1,
      selectionEnd: 1,
      composing: false,
      compositionSuspended: false,
      compositionRangeStart: 0,
      compositionRangeEnd: 2,
    };
    const result = finishComposingText(s, true);
    // clearComposition should zero out the ranges
    expect(result.state.compositionRangeStart).toBe(0);
    expect(result.state.compositionRangeEnd).toBe(0);
    expect(result.state.composing).toBe(false);
    expect(result.effects).toEqual([]);
  });
});

// ============================================================
// 7. cancelComposition immediately after setComposition
// ============================================================

test.describe("cancelComposition immediately after setComposition", () => {
  test("cancel right after first setComposition", () => {
    const s = createState({ text: "abc", selectionStart: 3, selectionEnd: 3 });
    const compResult = setComposition(s, "X", 1, 1);
    expect(compResult.state.text).toBe("abcX");
    expect(compResult.state.composing).toBe(true);

    const cancelResult = cancelComposition(compResult.state);
    expect(cancelResult.state.text).toBe("abc");
    expect(cancelResult.state.composing).toBe(false);
    expect(cancelResult.state.selectionStart).toBe(3);
    expect(cancelResult.state.selectionEnd).toBe(3);
    expect(cancelResult.state.compositionRangeStart).toBe(0);
    expect(cancelResult.state.compositionRangeEnd).toBe(0);
    expect(cancelResult.effects.length).toBe(2);
    expect(cancelResult.effects[0].type).toBe("textupdate");
    expect(cancelResult.effects[1]).toEqual({ type: "compositionend", data: "" });
  });

  test("cancel on empty text after setComposition", () => {
    const s = createState();
    const compResult = setComposition(s, "hello", 5, 5);
    expect(compResult.state.text).toBe("hello");

    const cancelResult = cancelComposition(compResult.state);
    expect(cancelResult.state.text).toBe("");
    expect(cancelResult.state.selectionStart).toBe(0);
    expect(cancelResult.state.selectionEnd).toBe(0);
    expect(cancelResult.state.composing).toBe(false);
  });

  test("setComposition with multi-character text then immediate cancel restores original", () => {
    const s = createState({ text: "original", selectionStart: 4, selectionEnd: 4 });
    const compState = setComposition(s, "INSERTED", 8, 8).state;
    expect(compState.text).toBe("origINSERTEDinal");

    const cancelResult = cancelComposition(compState);
    expect(cancelResult.state.text).toBe("original");
    expect(cancelResult.state.selectionStart).toBe(4);
  });

  test("cancel when setComposition replaced a selection", () => {
    const s = createState({ text: "abcdef", selectionStart: 1, selectionEnd: 4 });
    const compState = setComposition(s, "X", 1, 1).state;
    // "bcd" replaced with "X": text = "aXef"
    expect(compState.text).toBe("aXef");

    const cancelResult = cancelComposition(compState);
    // Cancelling removes the composition text "X" from range [1,2]
    expect(cancelResult.state.text).toBe("aef");
    expect(cancelResult.state.selectionStart).toBe(1);
    // Note: the original "bcd" is lost -- cancel only removes composition text
  });
});

// ============================================================
// 8. updateSelection during composition to same position
// ============================================================

test.describe("updateSelection during composition to same position", () => {
  test("same selection values do not cancel composition", () => {
    let s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });
    s = setComposition(s, "xy", 2, 2).state;
    // sel = (7, 7)

    const result = updateSelection(s, 7, 7);
    expect(result.state.composing).toBe(true);
    expect(result.state.text).toBe("helloxy");
    expect(result.state.selectionStart).toBe(7);
    expect(result.state.selectionEnd).toBe(7);
    expect(result.effects).toEqual([]);
  });

  test("same non-collapsed selection values do not cancel composition", () => {
    // Manually set non-collapsed selection during composition
    const s: EditContextState = {
      text: "helloXY",
      selectionStart: 5,
      selectionEnd: 7,
      composing: true,
      compositionSuspended: false,
      compositionRangeStart: 5,
      compositionRangeEnd: 7,
    };
    const result = updateSelection(s, 5, 7);
    expect(result.state.composing).toBe(true);
    expect(result.effects).toEqual([]);
  });

  test("slightly different selection cancels composition", () => {
    let s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });
    s = setComposition(s, "xy", 2, 2).state;

    // Move selection by 1 position
    const result = updateSelection(s, 6, 6);
    // Composition should be cancelled
    expect(result.state.composing).toBe(false);
    // Composition text "xy" is removed
    expect(result.state.text).toBe("hello");
  });

  test("updateSelection to 0,0 during composition at start of text", () => {
    let s = createState({ text: "", selectionStart: 0, selectionEnd: 0 });
    s = setComposition(s, "abc", 3, 3).state;
    // sel = (3, 3), so updateSelection(0, 0) changes selection => cancel

    const result = updateSelection(s, 0, 0);
    expect(result.state.composing).toBe(false);
    expect(result.state.text).toBe(""); // composition text removed
    expect(result.state.selectionStart).toBe(0);
    expect(result.state.selectionEnd).toBe(0);
  });
});

// ============================================================
// 9. deleteBackward/Forward on single-character text
// ============================================================

test.describe("deleteBackward/Forward on single-character text", () => {
  test("deleteBackward on single char with cursor at end", () => {
    const s = createState({ text: "x", selectionStart: 1, selectionEnd: 1 });
    const result = deleteBackward(s);
    expect(result.state.text).toBe("");
    expect(result.state.selectionStart).toBe(0);
    expect(result.state.selectionEnd).toBe(0);
    expect(result.effects.length).toBe(1);
    expect(result.effects[0]).toEqual({
      type: "textupdate",
      text: "",
      updateRangeStart: 0,
      updateRangeEnd: 1,
      selectionStart: 0,
      selectionEnd: 0,
    });
  });

  test("deleteBackward on single char with cursor at start is no-op", () => {
    const s = createState({ text: "x", selectionStart: 0, selectionEnd: 0 });
    const result = deleteBackward(s);
    expect(result.state.text).toBe("x");
    expect(result.effects).toEqual([]);
  });

  test("deleteForward on single char with cursor at start", () => {
    const s = createState({ text: "x", selectionStart: 0, selectionEnd: 0 });
    const result = deleteForward(s);
    expect(result.state.text).toBe("");
    expect(result.state.selectionStart).toBe(0);
    expect(result.state.selectionEnd).toBe(0);
    expect(result.effects.length).toBe(1);
    expect(result.effects[0]).toEqual({
      type: "textupdate",
      text: "",
      updateRangeStart: 0,
      updateRangeEnd: 1,
      selectionStart: 0,
      selectionEnd: 0,
    });
  });

  test("deleteForward on single char with cursor at end is no-op", () => {
    const s = createState({ text: "x", selectionStart: 1, selectionEnd: 1 });
    const result = deleteForward(s);
    expect(result.state.text).toBe("x");
    expect(result.effects).toEqual([]);
  });

  test("deleteBackward on single emoji character", () => {
    const s = createState({ text: "\u{1F600}", selectionStart: 2, selectionEnd: 2 });
    const result = deleteBackward(s);
    expect(result.state.text).toBe("");
    expect(result.state.selectionStart).toBe(0);
    expect(result.state.selectionEnd).toBe(0);
  });

  test("deleteForward on single emoji character", () => {
    const s = createState({ text: "\u{1F600}", selectionStart: 0, selectionEnd: 0 });
    const result = deleteForward(s);
    expect(result.state.text).toBe("");
    expect(result.state.selectionStart).toBe(0);
    expect(result.state.selectionEnd).toBe(0);
  });

  test("deleteBackward on entire single-char text selected", () => {
    const s = createState({ text: "z", selectionStart: 0, selectionEnd: 1 });
    const result = deleteBackward(s);
    expect(result.state.text).toBe("");
    expect(result.state.selectionStart).toBe(0);
    expect(result.state.selectionEnd).toBe(0);
  });

  test("deleteForward on entire single-char text selected", () => {
    const s = createState({ text: "z", selectionStart: 0, selectionEnd: 1 });
    const result = deleteForward(s);
    expect(result.state.text).toBe("");
    expect(result.state.selectionStart).toBe(0);
    expect(result.state.selectionEnd).toBe(0);
  });

  test("deleteWordBackward on single-word single-char text", () => {
    const s = createState({ text: "a", selectionStart: 1, selectionEnd: 1 });
    const result = deleteWordBackward(s);
    expect(result.state.text).toBe("");
    expect(result.state.selectionStart).toBe(0);
  });

  test("deleteWordForward on single-word single-char text", () => {
    const s = createState({ text: "a", selectionStart: 0, selectionEnd: 0 });
    const result = deleteWordForward(s);
    expect(result.state.text).toBe("");
    expect(result.state.selectionStart).toBe(0);
  });

  test("deleteBackward and deleteForward on empty text are no-ops", () => {
    const s = createState();
    expect(deleteBackward(s).state.text).toBe("");
    expect(deleteBackward(s).effects).toEqual([]);
    expect(deleteForward(s).state.text).toBe("");
    expect(deleteForward(s).effects).toEqual([]);
  });
});

// ============================================================
// 10. Composition in the middle of existing text
// ============================================================

test.describe("composition in the middle of existing text", () => {
  test("setComposition at cursor in middle inserts composition there", () => {
    const s = createState({ text: "abcdef", selectionStart: 3, selectionEnd: 3 });
    const result = setComposition(s, "XY", 2, 2);
    expect(result.state.text).toBe("abcXYdef");
    expect(result.state.compositionRangeStart).toBe(3);
    expect(result.state.compositionRangeEnd).toBe(5);
    expect(result.state.selectionStart).toBe(5);
    expect(result.state.selectionEnd).toBe(5);
  });

  test("continue composition in middle updates only composition range", () => {
    let s = createState({ text: "abcdef", selectionStart: 3, selectionEnd: 3 });
    s = setComposition(s, "X", 1, 1).state;
    // text = "abcXdef", compRange = [3, 4]

    const result = setComposition(s, "XYZ", 3, 3);
    // Replaces compRange [3,4] with "XYZ"
    expect(result.state.text).toBe("abcXYZdef");
    expect(result.state.compositionRangeStart).toBe(3);
    expect(result.state.compositionRangeEnd).toBe(6);
    expect(result.state.selectionStart).toBe(6);
    expect(result.state.selectionEnd).toBe(6);
  });

  test("commitText in middle finalizes composition and preserves surrounding text", () => {
    let s = createState({ text: "abcdef", selectionStart: 3, selectionEnd: 3 });
    s = setComposition(s, "XY", 2, 2).state;
    // text = "abcXYdef", compRange = [3, 5]

    const result = commitText(s, "Z");
    expect(result.state.text).toBe("abcZdef");
    expect(result.state.selectionStart).toBe(4);
    expect(result.state.selectionEnd).toBe(4);
    expect(result.state.composing).toBe(false);

    // Effects: textupdate + compositionend
    expect(result.effects.length).toBe(2);
    expect(result.effects[0]).toEqual({
      type: "textupdate",
      text: "Z",
      updateRangeStart: 3,
      updateRangeEnd: 5,
      selectionStart: 4,
      selectionEnd: 4,
    });
    expect(result.effects[1]).toEqual({ type: "compositionend", data: "Z" });
  });

  test("cancelComposition in middle removes only the composed text", () => {
    let s = createState({ text: "abcdef", selectionStart: 3, selectionEnd: 3 });
    s = setComposition(s, "XYZ", 3, 3).state;
    // text = "abcXYZdef", compRange = [3, 6]

    const result = cancelComposition(s);
    expect(result.state.text).toBe("abcdef");
    expect(result.state.selectionStart).toBe(3);
    expect(result.state.selectionEnd).toBe(3);
    expect(result.state.composing).toBe(false);
  });

  test("composition replacing selected range in middle", () => {
    const s = createState({ text: "abcdef", selectionStart: 2, selectionEnd: 4 });
    // Selection covers "cd"
    const result = setComposition(s, "XY", 2, 2);
    // "cd" replaced with "XY"
    expect(result.state.text).toBe("abXYef");
    expect(result.state.compositionRangeStart).toBe(2);
    expect(result.state.compositionRangeEnd).toBe(4);
    expect(result.state.selectionStart).toBe(4);
    expect(result.state.selectionEnd).toBe(4);
  });

  test("finishComposingText in middle with keepSelection=true", () => {
    let s = createState({ text: "abcdef", selectionStart: 3, selectionEnd: 3 });
    s = setComposition(s, "XY", 2, 2).state;
    // text = "abcXYdef", sel = (5, 5), compRange = [3, 5]

    const result = finishComposingText(s, true);
    expect(result.state.text).toBe("abcXYdef");
    expect(result.state.selectionStart).toBe(5); // unchanged
    expect(result.state.selectionEnd).toBe(5);
    expect(result.state.composing).toBe(false);
    expect(result.effects[0]).toEqual({ type: "compositionend", data: "XY" });
  });

  test("finishComposingText in middle with keepSelection=false", () => {
    let s = createState({ text: "abcdef", selectionStart: 3, selectionEnd: 3 });
    s = setComposition(s, "XY", 2, 2).state;
    // text = "abcXYdef", sel = (5, 5), compRange = [3, 5], comp length = 2

    const result = finishComposingText(s, false);
    expect(result.state.text).toBe("abcXYdef");
    expect(result.state.selectionStart).toBe(7); // 5 + 2
    expect(result.state.selectionEnd).toBe(7);
    expect(result.state.composing).toBe(false);
  });

  test("multiple compositions at different positions in text", () => {
    // First composition at position 3
    let s = createState({ text: "abcdef", selectionStart: 3, selectionEnd: 3 });
    s = setComposition(s, "1", 1, 1).state;
    s = commitText(s, "1").state;
    expect(s.text).toBe("abc1def");
    expect(s.selectionStart).toBe(4);

    // Now move selection to position 1 and compose there
    // (updateSelection would cancel, but we are not composing here)
    s = updateSelection(s, 1, 1).state;
    s = setComposition(s, "2", 1, 1).state;
    s = commitText(s, "2").state;
    expect(s.text).toBe("a2bc1def");
    expect(s.selectionStart).toBe(2);
  });
});

// ============================================================
// 11. Composition suspension (Category 4 fix)
// ============================================================

test.describe("composition suspension", () => {
  test("suspendComposition marks composition as suspended", () => {
    let s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });
    s = setComposition(s, "ka", 2, 2).state;
    expect(s.composing).toBe(true);
    expect(s.compositionSuspended).toBe(false);

    const suspended = suspendComposition(s);
    expect(suspended.composing).toBe(true);
    expect(suspended.compositionSuspended).toBe(true);
    // Composition range is preserved
    expect(suspended.compositionRangeStart).toBe(5);
    expect(suspended.compositionRangeEnd).toBe(7);
  });

  test("suspendComposition is no-op when not composing", () => {
    const s = createState({ text: "hello" });
    const result = suspendComposition(s);
    expect(result).toBe(s); // Same object reference
  });

  test("suspendComposition is no-op when already suspended", () => {
    let s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });
    s = setComposition(s, "ka", 2, 2).state;
    const suspended = suspendComposition(s);
    const doubleSuspended = suspendComposition(suspended);
    expect(doubleSuspended).toBe(suspended); // Same object reference
  });

  test("updateSelection does NOT cancel a suspended composition", () => {
    let s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });
    s = setComposition(s, "ka", 2, 2).state;
    s = suspendComposition(s);
    // text = "helloka", sel=(7,7), compRange=[5,7], suspended=true

    // Changing selection during suspended composition does NOT cancel it
    const result = updateSelection(s, 0, 0);
    expect(result.state.composing).toBe(true);
    expect(result.state.compositionSuspended).toBe(true);
    expect(result.state.text).toBe("helloka"); // Text NOT modified
    expect(result.state.compositionRangeStart).toBe(5);
    expect(result.state.compositionRangeEnd).toBe(7);
    expect(result.state.selectionStart).toBe(0);
    expect(result.state.selectionEnd).toBe(0);
    // No effects (no cancel)
    expect(result.effects).toEqual([]);
  });

  test("setComposition resumes a suspended composition without compositionstart", () => {
    let s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });
    s = setComposition(s, "ka", 2, 2).state;
    s = suspendComposition(s);
    // text = "helloka", compRange=[5,7], suspended=true

    // Resume with new composition text
    const result = setComposition(s, "kan", 3, 3);
    expect(result.state.composing).toBe(true);
    expect(result.state.compositionSuspended).toBe(false);
    expect(result.state.text).toBe("hellokan");
    expect(result.state.compositionRangeStart).toBe(5);
    expect(result.state.compositionRangeEnd).toBe(8);
    // No compositionstart effect — resuming, not starting new
    const compositionStartEffects = result.effects.filter((e) => e.type === "compositionstart");
    expect(compositionStartEffects.length).toBe(0);
    // Should have textupdate
    expect(result.effects.length).toBe(1);
    expect(result.effects[0].type).toBe("textupdate");
  });

  test("finishComposingText reads current text at composition range (not stale)", () => {
    let s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });
    s = setComposition(s, "ka", 2, 2).state;
    s = suspendComposition(s);
    // text = "helloka", compRange=[5,7], suspended=true

    // Simulate non-IME input overwriting text within the composition range
    // by using insertText at the current selection (which is at 7, after "ka")
    s = insertText(s, "XY").state;
    // text = "hellokaXY", sel=(9,9), compRange still [5,7]

    // Now finishComposingText should read "ka" (current text at [5,7])
    const result = finishComposingText(s, true);
    expect(result.state.composing).toBe(false);
    expect(result.effects.length).toBe(1);
    expect(result.effects[0]).toEqual({ type: "compositionend", data: "ka" });
  });

  test("cancelComposition clears suspended state", () => {
    let s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });
    s = setComposition(s, "ka", 2, 2).state;
    s = suspendComposition(s);

    const result = cancelComposition(s);
    expect(result.state.composing).toBe(false);
    expect(result.state.compositionSuspended).toBe(false);
    expect(result.state.text).toBe("hello"); // "ka" removed
  });

  test("commitText clears suspended state", () => {
    let s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });
    s = setComposition(s, "ka", 2, 2).state;
    s = suspendComposition(s);

    const result = commitText(s, "\u304B");
    expect(result.state.composing).toBe(false);
    expect(result.state.compositionSuspended).toBe(false);
    expect(result.state.text).toBe("hello\u304B");
  });

  test("suspended composition: insertText does not affect composition range", () => {
    let s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });
    s = setComposition(s, "ka", 2, 2).state;
    s = suspendComposition(s);
    // text="helloka", compRange=[5,7], sel=(7,7)

    // Insert text at current selection (after composition)
    const result = insertText(s, "Z");
    expect(result.state.text).toBe("hellokaZ");
    // Composition range is unchanged
    expect(result.state.compositionRangeStart).toBe(5);
    expect(result.state.compositionRangeEnd).toBe(7);
    expect(result.state.composing).toBe(true);
    expect(result.state.compositionSuspended).toBe(true);
  });

  test("full suspend-resume cycle: compose -> suspend -> insert -> resume -> finish", () => {
    let s = createState({ text: "", selectionStart: 0, selectionEnd: 0 });

    // Start composition
    let r = setComposition(s, "ka", 2, 2);
    expect(r.effects.filter((e) => e.type === "compositionstart").length).toBe(1);
    s = r.state;
    // text="ka", compRange=[0,2]

    // Suspend (non-IME input arrives)
    s = suspendComposition(s);
    // Insert a character
    s = insertText(s, "X").state;
    // text="kaX", sel=(3,3), compRange=[0,2]

    // Resume composition
    r = setComposition(s, "kan", 3, 3);
    // No compositionstart (resuming)
    expect(r.effects.filter((e) => e.type === "compositionstart").length).toBe(0);
    s = r.state;
    // text="kanX", compRange=[0,3], sel=(3,3)
    expect(s.text).toBe("kanX");
    expect(s.compositionRangeStart).toBe(0);
    expect(s.compositionRangeEnd).toBe(3);

    // Finish composing
    r = finishComposingText(s, true);
    expect(r.effects[0]).toEqual({ type: "compositionend", data: "kan" });
    expect(r.state.composing).toBe(false);
    expect(r.state.text).toBe("kanX");
  });

  test("setComposition with empty text cancels a suspended composition", () => {
    let s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });
    s = setComposition(s, "ka", 2, 2).state;
    s = suspendComposition(s);

    // Empty setComposition should cancel
    const result = setComposition(s, "", 0, 0);
    expect(result.state.composing).toBe(false);
    expect(result.state.compositionSuspended).toBe(false);
    expect(result.state.text).toBe("hello"); // "ka" removed
    expect(result.effects.length).toBe(2); // textupdate + compositionend
    expect(result.effects[1]).toEqual({ type: "compositionend", data: "" });
  });

  test("createState always has compositionSuspended: false", () => {
    const s = createState({ text: "hello", selectionStart: 2, selectionEnd: 3 });
    expect(s.compositionSuspended).toBe(false);
  });
});
