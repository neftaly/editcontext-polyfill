import { test, expect } from "@playwright/test";
import {
  type EditContextState,
  type EditContextTransition,
  type EditContextEffect,
  createState,
  updateText,
  updateSelection,
  setComposition,
  commitText,
  insertText,
  cancelComposition,
  finishComposingText,
  deleteBackward,
  deleteForward,
  deleteWordBackward,
  deleteWordForward,
} from "../../src/edit-context-state.js";

// Pure state tests — no browser needed, runs directly in Node.

// ============================================================
// 1. createState
// ============================================================

test.describe("createState", () => {
  test("default values when called with no arguments", () => {
    const result = createState();
    expect(result).toEqual({
      text: "",
      selectionStart: 0,
      selectionEnd: 0,
      composing: false,
      compositionSuspended: false,
      compositionRangeStart: 0,
      compositionRangeEnd: 0,
    });
  });

  test("accepts init options", () => {
    const result = createState({
      text: "hello",
      selectionStart: 2,
      selectionEnd: 4,
    });
    expect(result).toEqual({
      text: "hello",
      selectionStart: 2,
      selectionEnd: 4,
      composing: false,
      compositionSuspended: false,
      compositionRangeStart: 0,
      compositionRangeEnd: 0,
    });
  });

  test("clamps selectionStart to text length", () => {
    const result = createState({ text: "ab", selectionStart: 100, selectionEnd: 1 });
    expect(result.selectionStart).toBe(2);
    expect(result.selectionEnd).toBe(1);
  });

  test("clamps selectionEnd to text length", () => {
    const result = createState({ text: "ab", selectionStart: 0, selectionEnd: 999 });
    expect(result.selectionEnd).toBe(2);
  });

  test("clamps both selectionStart and selectionEnd", () => {
    const result = createState({ text: "", selectionStart: 5, selectionEnd: 10 });
    expect(result.selectionStart).toBe(0);
    expect(result.selectionEnd).toBe(0);
  });
});

// ============================================================
// 2. updateText
// ============================================================

test.describe("updateText", () => {
  test("basic splice replaces range", () => {
    const s = createState({ text: "abcdef" });
    const result = updateText(s, 1, 3, "XY");
    expect(result.state.text).toBe("aXYdef");
    expect(result.effects).toEqual([]);
  });

  test("range swap: start > end is swapped silently", () => {
    const s = createState({ text: "abcdef" });
    const result = updateText(s, 3, 0, "XY");
    expect(result.state.text).toBe("XYdef");
  });

  test("rangeEnd clamped to text length", () => {
    const s = createState({ text: "abc" });
    const result = updateText(s, 1, 100, "X");
    expect(result.state.text).toBe("aX");
  });

  test("rangeStart clamped when both exceed text length", () => {
    const s = createState({ text: "abc" });
    const result = updateText(s, 100, 200, "XY");
    expect(result.state.text).toBe("abcXY");
  });

  test("does not adjust selection", () => {
    const s = createState({ text: "abcdef", selectionStart: 5, selectionEnd: 5 });
    const result = updateText(s, 0, 2, "XYZ");
    expect(result.state.selectionStart).toBe(5);
    expect(result.state.selectionEnd).toBe(5);
  });

  test("produces no effects", () => {
    const s = createState({ text: "abc" });
    const result = updateText(s, 0, 1, "Z");
    expect(result.effects).toEqual([]);
  });
});

// ============================================================
// 3. updateSelection
// ============================================================

test.describe("updateSelection", () => {
  test("basic set updates selection", () => {
    const s = createState({ text: "hello", selectionStart: 0, selectionEnd: 0 });
    const result = updateSelection(s, 2, 4);
    expect(result.state.selectionStart).toBe(2);
    expect(result.state.selectionEnd).toBe(4);
    expect(result.effects).toEqual([]);
  });

  test("clamps to text length", () => {
    const s = createState({ text: "ab" });
    const result = updateSelection(s, 10, 20);
    expect(result.state.selectionStart).toBe(2);
    expect(result.state.selectionEnd).toBe(2);
  });

  test("cancels composition when selection changes", () => {
    let s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });
    s = setComposition(s, "ka", 2, 2).state;
    const result = updateSelection(s, 0, 0);
    // Composition text "ka" removed
    expect(result.state.text).toBe("hello");
    expect(result.state.composing).toBe(false);
    expect(result.state.selectionStart).toBe(0);
    expect(result.state.selectionEnd).toBe(0);
    // Should have textupdate (deletion) + compositionend effects
    expect(result.effects.length).toBe(2);
    expect(result.effects[0].type).toBe("textupdate");
    expect(result.effects[1].type).toBe("compositionend");
  });

  test("no cancellation when selection does not change during composition", () => {
    let s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });
    s = setComposition(s, "ka", 2, 2).state;
    // Set selection to the same values — should NOT cancel
    const result = updateSelection(s, s.selectionStart, s.selectionEnd);
    expect(result.state.composing).toBe(true);
    expect(result.state.text).toBe("helloka");
    expect(result.effects).toEqual([]);
  });
});

// ============================================================
// 4. setComposition
// ============================================================

test.describe("setComposition", () => {
  test("starts composition with compositionstart effect", () => {
    const s = createState({ text: "", selectionStart: 0, selectionEnd: 0 });
    const result = setComposition(s, "k", 1, 1);
    expect(result.state.composing).toBe(true);
    expect(result.state.text).toBe("k");
    expect(result.state.compositionRangeStart).toBe(0);
    expect(result.state.compositionRangeEnd).toBe(1);
    expect(result.effects.length).toBe(2);
    expect(result.effects[0]).toEqual({ type: "compositionstart", data: "k" });
    expect(result.effects[1]).toEqual({
      type: "textupdate",
      text: "k",
      updateRangeStart: 0,
      updateRangeEnd: 0,
      selectionStart: 1,
      selectionEnd: 1,
    });
  });

  test("continues composition: replaces composition range", () => {
    let s = createState({ text: "", selectionStart: 0, selectionEnd: 0 });
    s = setComposition(s, "k", 1, 1).state;
    const result = setComposition(s, "ka", 2, 2);
    expect(result.state.composing).toBe(true);
    expect(result.state.text).toBe("ka");
    expect(result.state.compositionRangeStart).toBe(0);
    expect(result.state.compositionRangeEnd).toBe(2);
    // Continuing composition should NOT fire compositionstart again
    expect(result.effects.length).toBe(1);
    expect(result.effects[0]).toEqual({
      type: "textupdate",
      text: "ka",
      updateRangeStart: 0,
      updateRangeEnd: 1,
      selectionStart: 2,
      selectionEnd: 2,
    });
  });

  test("empty text cancels active composition", () => {
    let s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });
    s = setComposition(s, "ka", 2, 2).state;
    const result = setComposition(s, "", 0, 0);
    expect(result.state.text).toBe("hello");
    expect(result.state.composing).toBe(false);
    // Should have textupdate (deletion) + compositionend
    expect(result.effects.length).toBe(2);
    expect(result.effects[0].type).toBe("textupdate");
    expect((result.effects[0] as Extract<EditContextEffect, { type: "textupdate" }>).text).toBe("");
    expect(result.effects[1]).toEqual({ type: "compositionend", data: "" });
  });

  test("empty text on non-composing state is a no-op", () => {
    const s = createState({ text: "hello" });
    const result = setComposition(s, "", 0, 0);
    expect(result.state.text).toBe("hello");
    expect(result.state.composing).toBe(false);
    expect(result.effects).toEqual([]);
  });

  test("composition after existing text uses selection position", () => {
    const s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });
    const result = setComposition(s, "w", 1, 1);
    expect(result.state.text).toBe("hellow");
    expect(result.state.compositionRangeStart).toBe(5);
    expect(result.state.compositionRangeEnd).toBe(6);
    expect(result.state.selectionStart).toBe(6);
    expect(result.state.selectionEnd).toBe(6);
  });

  test("composition replaces selected range", () => {
    const s = createState({ text: "abcdef", selectionStart: 1, selectionEnd: 4 });
    const result = setComposition(s, "X", 1, 1);
    expect(result.state.text).toBe("aXef");
    expect(result.state.compositionRangeStart).toBe(1);
    expect(result.state.compositionRangeEnd).toBe(2);
  });
});

// ============================================================
// 5. commitText
// ============================================================

test.describe("commitText", () => {
  test("with active composition: commits and ends composition", () => {
    let s = createState();
    s = setComposition(s, "ka", 2, 2).state;
    const result = commitText(s, "\u304B"); // か
    expect(result.state.text).toBe("\u304B");
    expect(result.state.composing).toBe(false);
    expect(result.state.selectionStart).toBe(1);
    expect(result.state.selectionEnd).toBe(1);
    expect(result.state.compositionRangeStart).toBe(0);
    expect(result.state.compositionRangeEnd).toBe(0);
    // Should have textupdate + compositionend
    expect(result.effects.length).toBe(2);
    expect(result.effects[0]).toEqual({
      type: "textupdate",
      text: "\u304B",
      updateRangeStart: 0,
      updateRangeEnd: 2,
      selectionStart: 1,
      selectionEnd: 1,
    });
    expect(result.effects[1]).toEqual({ type: "compositionend", data: "\u304B" });
  });

  test("without active composition: inserts at selection", () => {
    const s = createState({ text: "abc", selectionStart: 1, selectionEnd: 2 });
    const result = commitText(s, "XY");
    expect(result.state.text).toBe("aXYc");
    expect(result.state.selectionStart).toBe(3);
    expect(result.state.selectionEnd).toBe(3);
    expect(result.state.composing).toBe(false);
    // Should have textupdate but NO compositionend (not composing)
    expect(result.effects.length).toBe(1);
    expect(result.effects[0]).toEqual({
      type: "textupdate",
      text: "XY",
      updateRangeStart: 1,
      updateRangeEnd: 2,
      selectionStart: 3,
      selectionEnd: 3,
    });
  });

  test("empty commit during composition: textupdate only, no compositionend", () => {
    let s = createState();
    s = setComposition(s, "ka", 2, 2).state;
    const result = commitText(s, "");
    expect(result.state.text).toBe("");
    expect(result.state.composing).toBe(false);
    // Empty commit text => textupdate but no compositionend
    expect(result.effects.length).toBe(1);
    expect(result.effects[0].type).toBe("textupdate");
  });
});

// ============================================================
// 6. insertText
// ============================================================

test.describe("insertText", () => {
  test("inserts at collapsed selection", () => {
    const s = createState({ text: "abcdef", selectionStart: 3, selectionEnd: 3 });
    const result = insertText(s, "XY");
    expect(result.state.text).toBe("abcXYdef");
    expect(result.state.selectionStart).toBe(5);
    expect(result.state.selectionEnd).toBe(5);
    expect(result.effects.length).toBe(1);
    expect(result.effects[0]).toEqual({
      type: "textupdate",
      text: "XY",
      updateRangeStart: 3,
      updateRangeEnd: 3,
      selectionStart: 5,
      selectionEnd: 5,
    });
  });

  test("replaces non-collapsed selection", () => {
    const s = createState({ text: "abcdef", selectionStart: 1, selectionEnd: 4 });
    const result = insertText(s, "Z");
    expect(result.state.text).toBe("aZef");
    expect(result.state.selectionStart).toBe(2);
    expect(result.state.selectionEnd).toBe(2);
    expect(result.effects[0]).toEqual({
      type: "textupdate",
      text: "Z",
      updateRangeStart: 1,
      updateRangeEnd: 4,
      selectionStart: 2,
      selectionEnd: 2,
    });
  });

  test("inserts with backward selection (start > end)", () => {
    // Backward selection: start=4, end=1
    const s: EditContextState = {
      text: "abcdef",
      selectionStart: 4,
      selectionEnd: 1,
      composing: false,
      compositionSuspended: false,
      compositionRangeStart: 0,
      compositionRangeEnd: 0,
    };
    const result = insertText(s, "Z");
    // min=1, max=4, so replaces "bcd"
    expect(result.state.text).toBe("aZef");
    expect(result.state.selectionStart).toBe(2);
    expect(result.state.selectionEnd).toBe(2);
  });
});

// ============================================================
// 7. cancelComposition
// ============================================================

test.describe("cancelComposition", () => {
  test("removes composed text and fires effects", () => {
    let s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });
    s = setComposition(s, "ka", 2, 2).state;
    const result = cancelComposition(s);
    expect(result.state.text).toBe("hello");
    expect(result.state.composing).toBe(false);
    expect(result.state.selectionStart).toBe(5);
    expect(result.state.selectionEnd).toBe(5);
    expect(result.state.compositionRangeStart).toBe(0);
    expect(result.state.compositionRangeEnd).toBe(0);
    // Effects: textupdate (deletion) then compositionend
    expect(result.effects.length).toBe(2);
    expect(result.effects[0]).toEqual({
      type: "textupdate",
      text: "",
      updateRangeStart: 5,
      updateRangeEnd: 7,
      selectionStart: 5,
      selectionEnd: 5,
    });
    expect(result.effects[1]).toEqual({ type: "compositionend", data: "" });
  });

  test("no-op when not composing", () => {
    const s = createState({ text: "hello" });
    const result = cancelComposition(s);
    expect(result.state.text).toBe("hello");
    expect(result.effects).toEqual([]);
  });
});

// ============================================================
// 8. finishComposingText
// ============================================================

test.describe("finishComposingText", () => {
  test("keepSelection=true: selection stays, text kept", () => {
    let s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });
    s = setComposition(s, "ka", 2, 2).state;
    const result = finishComposingText(s, true);
    expect(result.state.text).toBe("helloka");
    expect(result.state.composing).toBe(false);
    // keepSelection=true => selection unchanged from composition state
    expect(result.state.selectionStart).toBe(7);
    expect(result.state.selectionEnd).toBe(7);
    expect(result.state.compositionRangeStart).toBe(0);
    expect(result.state.compositionRangeEnd).toBe(0);
    expect(result.effects.length).toBe(1);
    expect(result.effects[0]).toEqual({ type: "compositionend", data: "ka" });
  });

  test("keepSelection=false: selection moves by text length", () => {
    let s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });
    s = setComposition(s, "ka", 2, 2).state;
    const result = finishComposingText(s, false);
    expect(result.state.text).toBe("helloka");
    expect(result.state.composing).toBe(false);
    // keepSelection=false => selection advances by composition length (2)
    expect(result.state.selectionStart).toBe(9);
    expect(result.state.selectionEnd).toBe(9);
    expect(result.effects.length).toBe(1);
    expect(result.effects[0]).toEqual({ type: "compositionend", data: "ka" });
  });

  test("no-op when not composing", () => {
    const s = createState({ text: "hello" });
    const result = finishComposingText(s, true);
    expect(result.state.text).toBe("hello");
    expect(result.state.composing).toBe(false);
    expect(result.effects).toEqual([]);
  });
});

// ============================================================
// 9. deleteBackward / deleteForward
// ============================================================

test.describe("deleteBackward", () => {
  test("collapsed selection: deletes one grapheme backward", () => {
    const s = createState({ text: "abcdef", selectionStart: 3, selectionEnd: 3 });
    const result = deleteBackward(s);
    expect(result.state.text).toBe("abdef");
    expect(result.state.selectionStart).toBe(2);
    expect(result.state.selectionEnd).toBe(2);
    expect(result.effects.length).toBe(1);
    expect(result.effects[0]).toEqual({
      type: "textupdate",
      text: "",
      updateRangeStart: 2,
      updateRangeEnd: 3,
      selectionStart: 2,
      selectionEnd: 2,
    });
  });

  test("non-collapsed selection: deletes selection", () => {
    const s = createState({ text: "abcdef", selectionStart: 1, selectionEnd: 4 });
    const result = deleteBackward(s);
    expect(result.state.text).toBe("aef");
    expect(result.state.selectionStart).toBe(1);
    expect(result.state.selectionEnd).toBe(1);
  });

  test("at start of text: no-op", () => {
    const s = createState({ text: "abc", selectionStart: 0, selectionEnd: 0 });
    const result = deleteBackward(s);
    expect(result.state.text).toBe("abc");
    expect(result.effects).toEqual([]);
  });

  test("deletes whole emoji cluster", () => {
    const text = "a\u{1F600}b"; // "a😀b"
    const s = createState({
      text,
      selectionStart: 3, // after emoji (2 UTF-16 code units)
      selectionEnd: 3,
    });
    const result = deleteBackward(s);
    expect(result.state.text).toBe("ab");
  });
});

test.describe("deleteForward", () => {
  test("collapsed selection: deletes one grapheme forward", () => {
    const s = createState({ text: "abcdef", selectionStart: 2, selectionEnd: 2 });
    const result = deleteForward(s);
    expect(result.state.text).toBe("abdef");
    expect(result.state.selectionStart).toBe(2);
    expect(result.state.selectionEnd).toBe(2);
    expect(result.effects.length).toBe(1);
    expect(result.effects[0]).toEqual({
      type: "textupdate",
      text: "",
      updateRangeStart: 2,
      updateRangeEnd: 3,
      selectionStart: 2,
      selectionEnd: 2,
    });
  });

  test("non-collapsed selection: deletes selection", () => {
    const s = createState({ text: "abcdef", selectionStart: 2, selectionEnd: 5 });
    const result = deleteForward(s);
    expect(result.state.text).toBe("abf");
    expect(result.state.selectionStart).toBe(2);
    expect(result.state.selectionEnd).toBe(2);
  });

  test("at end of text: no-op", () => {
    const s = createState({ text: "abc", selectionStart: 3, selectionEnd: 3 });
    const result = deleteForward(s);
    expect(result.state.text).toBe("abc");
    expect(result.effects).toEqual([]);
  });

  test("deletes whole emoji cluster forward", () => {
    const text = "a\u{1F600}b"; // "a😀b"
    const s = createState({
      text,
      selectionStart: 1, // before emoji
      selectionEnd: 1,
    });
    const result = deleteForward(s);
    expect(result.state.text).toBe("ab");
  });
});

// ============================================================
// 10. deleteWordBackward / deleteWordForward
// ============================================================

test.describe("deleteWordBackward", () => {
  test("deletes word backward from end of word", () => {
    const s = createState({ text: "hello world", selectionStart: 5, selectionEnd: 5 });
    const result = deleteWordBackward(s);
    expect(result.state.text).toBe(" world");
    expect(result.state.selectionStart).toBe(0);
    expect(result.state.selectionEnd).toBe(0);
    expect(result.effects.length).toBe(1);
    expect(result.effects[0]).toEqual({
      type: "textupdate",
      text: "",
      updateRangeStart: 0,
      updateRangeEnd: 5,
      selectionStart: 0,
      selectionEnd: 0,
    });
  });

  test("deletes word backward from middle of second word", () => {
    const s = createState({ text: "hello world", selectionStart: 8, selectionEnd: 8 });
    const result = deleteWordBackward(s);
    // Position 8 is after "wo" in "world", word starts at 6, so "wo" is deleted
    expect(result.state.text).toBe("hello rld");
    expect(result.state.selectionStart).toBe(6);
  });

  test("non-collapsed selection: deletes selection without word expansion", () => {
    const s = createState({ text: "hello world", selectionStart: 2, selectionEnd: 8 });
    const result = deleteWordBackward(s);
    // Non-collapsed: just deletes "llo wo"
    expect(result.state.text).toBe("herld");
    expect(result.state.selectionStart).toBe(2);
  });

  test("at start of text: no-op", () => {
    const s = createState({ text: "hello", selectionStart: 0, selectionEnd: 0 });
    const result = deleteWordBackward(s);
    expect(result.state.text).toBe("hello");
    expect(result.effects).toEqual([]);
  });
});

test.describe("deleteWordForward", () => {
  test("deletes word forward from start of word", () => {
    const s = createState({ text: "hello world", selectionStart: 6, selectionEnd: 6 });
    const result = deleteWordForward(s);
    expect(result.state.text).toBe("hello ");
    expect(result.state.selectionStart).toBe(6);
    expect(result.state.selectionEnd).toBe(6);
    expect(result.effects.length).toBe(1);
    expect(result.effects[0]).toEqual({
      type: "textupdate",
      text: "",
      updateRangeStart: 6,
      updateRangeEnd: 11,
      selectionStart: 6,
      selectionEnd: 6,
    });
  });

  test("deletes word forward from space between words", () => {
    const s = createState({ text: "hello world", selectionStart: 5, selectionEnd: 5 });
    const result = deleteWordForward(s);
    // From position 5 (the space), should skip whitespace and delete "world"
    expect(result.state.text).toBe("hello");
    expect(result.state.selectionStart).toBe(5);
  });

  test("non-collapsed selection: deletes selection without word expansion", () => {
    const s = createState({ text: "hello world", selectionStart: 2, selectionEnd: 8 });
    const result = deleteWordForward(s);
    expect(result.state.text).toBe("herld");
    expect(result.state.selectionStart).toBe(2);
  });

  test("at end of text: no-op", () => {
    const s = createState({ text: "hello", selectionStart: 5, selectionEnd: 5 });
    const result = deleteWordForward(s);
    expect(result.state.text).toBe("hello");
    expect(result.effects).toEqual([]);
  });
});

// ============================================================
// 11. Backward selection handling in delete operations
// ============================================================

test.describe("backward selection handling in deletes", () => {
  test("deleteBackward with backward selection (start > end)", () => {
    // Backward selection: start=4, end=1
    const s: EditContextState = {
      text: "abcdef",
      selectionStart: 4,
      selectionEnd: 1,
      composing: false,
      compositionSuspended: false,
      compositionRangeStart: 0,
      compositionRangeEnd: 0,
    };
    const result = deleteBackward(s);
    // Deletes min(1,4)..max(1,4) = "bcd"
    expect(result.state.text).toBe("aef");
    // Backward: finalSel = origStart=4 (Chrome preserves beyond text.length)
    expect(result.state.selectionStart).toBe(4);
    expect(result.state.selectionEnd).toBe(4);
    // The textupdate effect uses deleteStart (1) for its selection
    expect(result.effects[0]).toEqual({
      type: "textupdate",
      text: "",
      updateRangeStart: 1,
      updateRangeEnd: 4,
      selectionStart: 1,
      selectionEnd: 1,
    });
  });

  test("deleteForward with backward selection (start > end)", () => {
    // Backward selection: start=5, end=2
    const s: EditContextState = {
      text: "abcdef",
      selectionStart: 5,
      selectionEnd: 2,
      composing: false,
      compositionSuspended: false,
      compositionRangeStart: 0,
      compositionRangeEnd: 0,
    };
    const result = deleteForward(s);
    // Deletes min(2,5)..max(2,5) = "cde"
    expect(result.state.text).toBe("abf");
    // Backward: finalSel = origStart=5 (Chrome preserves beyond text.length)
    expect(result.state.selectionStart).toBe(5);
    expect(result.state.selectionEnd).toBe(5);
  });

  test("deleteWordBackward with backward selection", () => {
    // Backward selection over "lo wo" in "hello world"
    const s: EditContextState = {
      text: "hello world",
      selectionStart: 8,
      selectionEnd: 3,
      composing: false,
      compositionSuspended: false,
      compositionRangeStart: 0,
      compositionRangeEnd: 0,
    };
    const result = deleteWordBackward(s);
    // Non-collapsed: deletes min(3,8)..max(3,8) = "lo wo"
    expect(result.state.text).toBe("helrld");
    // Backward: finalSel = origStart=8 (Chrome preserves beyond text.length)
    expect(result.state.selectionStart).toBe(8);
    expect(result.state.selectionEnd).toBe(8);
  });

  test("deleteWordForward with backward selection", () => {
    const s: EditContextState = {
      text: "hello world",
      selectionStart: 9,
      selectionEnd: 2,
      composing: false,
      compositionSuspended: false,
      compositionRangeStart: 0,
      compositionRangeEnd: 0,
    };
    const result = deleteWordForward(s);
    // Non-collapsed: deletes min(2,9)..max(2,9) = "llo wor"
    expect(result.state.text).toBe("held");
    // Backward: finalSel = origStart=9 (Chrome preserves beyond text.length)
    expect(result.state.selectionStart).toBe(9);
    expect(result.state.selectionEnd).toBe(9);
  });

  test("backward collapsed-equivalent: same position, no expansion needed", () => {
    const s: EditContextState = {
      text: "abc",
      selectionStart: 2,
      selectionEnd: 2,
      composing: false,
      compositionSuspended: false,
      compositionRangeStart: 0,
      compositionRangeEnd: 0,
    };
    const result = deleteBackward(s);
    // Normal collapsed backspace
    expect(result.state.text).toBe("ac");
    // Not backward (start === end), so finalSel = deleteStart = 1
    expect(result.state.selectionStart).toBe(1);
    expect(result.state.selectionEnd).toBe(1);
  });
});
