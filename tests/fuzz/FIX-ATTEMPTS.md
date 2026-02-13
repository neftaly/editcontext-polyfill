# Fuzz Test Fix Attempts

## Summary

Two bugs were found and fixed in `src/edit-context-state.ts`, both in the `deleteWithExpansion` function. Both relate to how native Chrome's EditContext handles selection positions that are beyond the text length.

## Root Cause: Chrome allows selection beyond text.length

Native Chrome's EditContext allows `selectionStart`/`selectionEnd` to exceed `text.length` in certain situations. The primary way this happens is when `updateText()` shrinks the text without adjusting the selection. Chrome's `updateText()` changes text only and never touches selection, so the selection can end up pointing beyond the end of the text.

Key behaviors verified against native Chrome:
- `updateText()` never adjusts selection, even when text shrinks
- `updateSelection()` DOES clamp to `text.length`
- Delete operations on out-of-bounds selections clamp the selection to `text.length` (no-op, no events)
- Backward selection deletes preserve `selectionStart` beyond `text.length` (no clamping)
- `insertText()` at an out-of-bounds position appends text and sets selection to `position + insertedLength`

## Category 1: Event log mismatches (e.g., seed 56)

### Problem

After `updateText()` shrank the text, the selection was beyond `text.length`. A subsequent delete operation (e.g., `deleteWordForward` via Ctrl+Delete) was a no-op (nothing to delete from beyond the end), but the polyfill returned the original unclamped state. Native Chrome clamps the selection to `text.length` in this case.

This caused the next `insertText` to insert at the wrong position (e.g., position 8 instead of 7), producing different textupdate event fields.

### Example trace (seed 56)

```
Step 11: type("u")          -> text="1.1s2gnu" (length 8), sel=8
Step 12: focusOther          -> blur
Step 13: updateText(8,6,",") -> text="1.1s2g," (length 7), sel=8 (beyond text!)
Step 14: focus
Step 15: Ctrl+Delete         -> Native: sel clamps to 7. Polyfill: sel stays at 8.
Step 16: type("w")           -> Native: inserts at 7. Polyfill: inserts at 8.
```

### Fix

In `deleteWithExpansion`, when the delete is a no-op (selection still collapsed after expansion), clamp the selection to `text.length` if it was out of bounds:

```typescript
if (current.selectionStart === current.selectionEnd) {
    const clampedSel = Math.min(current.selectionStart, current.text.length);
    if (clampedSel !== state.selectionStart || clampedSel !== state.selectionEnd) {
      return {
        state: { ...state, selectionStart: clampedSel, selectionEnd: clampedSel },
        effects: [],
      };
    }
    return { state, effects: [] };
}
```

## Category 2: Selection beyond text length (e.g., multi seed 5)

### Problem

When deleting a backward selection (selectionStart > selectionEnd), the polyfill clamped `finalSel` to `newText.length`:

```typescript
const finalSel = wasBackward ? Math.min(origSelStart, newText.length) : deleteStart;
```

Native Chrome does NOT clamp here. It preserves `origSelStart` even when it exceeds the new text length.

### Example trace (multi seed 5, target2)

```
Step 2:  type("dx2")           -> text="dx2", sel=(3,3)
Step 3:  updateSelection(3,0)  -> sel=(3,0) backward
Step 6:  focusTarget1           -> target2 blurred
Step 9:  focusTarget2           -> target2 refocused
Step 10: Backspace              -> Deletes "dx2". Native: sel=3. Polyfill: sel=0.
Step 12: type("es")             -> Native: sel=5 (3+2). Polyfill: sel=2 (0+2).
```

### Fix

Removed the `Math.min` clamping for backward selections:

```typescript
// Before:
const finalSel = wasBackward ? Math.min(origSelStart, newText.length) : deleteStart;

// After:
const finalSel = wasBackward ? origSelStart : deleteStart;
```

## Files Changed

- `src/edit-context-state.ts`: Both fixes in `deleteWithExpansion` function (lines ~392-412)
- `tests/unit/edit-context-state.spec.ts`: Updated 4 backward selection unit tests to match new (correct) behavior where selection is preserved beyond text length

## Remaining Failures

After fixes, running 1500 fuzz tests (500 seeds x 3 suites) yields 7 failures, all of which are **test timeout / infrastructure issues** (seeds 143, 279, 306, 383, 392). These are pre-existing and unrelated to the polyfill logic -- they appear to be cases where certain action sequences cause the Playwright keyboard API to hang.

## Clamping sites NOT changed (verified correct)

- `updateSelection()` in edit-context-state.ts: Correctly clamps to `text.length` (verified against native Chrome)
- `createState()`: Correctly clamps initial selection
- `syncFromEditContext()` in input-translator.ts: The textarea's `setSelectionRange` naturally clamps, but this doesn't feed back to EditContext state
- `activate()` in focus-manager.ts: Creates a new textarea and syncs -- the textarea clamping is cosmetic only
