# Fuzz Test Known Failures

Last updated: 2026-02-15
Tested with: Playwright 1.58.2, Chromium (bundled), 1000 seeds per suite
See also: `tests/fuzz/FIX-ATTEMPTS.md` for fix development notes

## Current Status

After applying all fixes (uncommitted in working tree):

- **Basic fuzz** (100 seeds): 100/100 pass (0% failure)
- **Shadow DOM fuzz** (100 seeds): 100/100 pass (0% failure)
- **Multi-context fuzz** (100 seeds): 100/100 pass (0% failure)
- **IME fuzz** (100 seeds): 97/100 pass (3% failure — Category 4)
- **Unit tests**: 206/206 pass

Categories 1, 2, and 3 bugs are fixed. Category 4 (3% IME) and Category 5
(timeouts, not polyfill bugs) remain open.

---

## Category 1 (FIXED): Event log mismatches

### Symptoms

`textupdate` event field mismatches between native and polyfill. The
`updateRangeStart` / `selectionStart` values in events were off by a small
constant offset. Final text + selection state matched -- only event details
differed.

Failure rate before fix: ~2.6% (26/1000).

### Root Cause

`deleteWithExpansion()` in `src/edit-context-state.ts` did not clamp an
out-of-bounds selection to `text.length` on no-op deletes.

When `updateText()` shrank the text while the element was unfocused, the
selection ended up beyond `text.length` (Chrome intentionally does NOT adjust
selection in `updateText`). A subsequent no-op delete operation (e.g.,
`deleteWordForward` with the cursor already at/beyond text end) returned the
original state unchanged, preserving the beyond-text-length selection.

Chrome's native EditContext, however, clamps the selection to `text.length`
during these no-op delete operations. The next `insertText` then inserted at
different positions: the polyfill at the unclamped position (e.g., 8), native
at the clamped position (e.g., 7). This produced shifted `updateRangeStart`
and `selectionStart` values in all subsequent `textupdate` events.

### Example (seed 56)

```
Step 11: type("u")            -> text="1.1s2gnu" (len 8), sel=8
Step 12: focusOther            -> blur
Step 13: updateText(8, 6, ",") -> text="1.1s2g,"  (len 7), sel=8 (beyond text!)
Step 14: focus                 -> re-focus, textarea synced (textarea clamps to 7, EditContext stays 8)
Step 15: Ctrl+Delete           -> deleteWordForward: no-op (nothing forward of len 7)
                                  Native:   sel clamped to 7
                                  Polyfill: sel stayed at 8 (BUG)
Step 16: type("wcq7")          -> Native:   inserts at 7, events start at updateRangeStart=7
                                  Polyfill: inserts at 8, events start at updateRangeStart=8
```

### Fix Applied

In `deleteWithExpansion()` (`src/edit-context-state.ts`, line ~392), when the
delete is a no-op (selection still collapsed after expansion), clamp the
selection to `text.length`:

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

### Previously Failing Seeds

Basic + shadow DOM fuzz: 56, 86, 104, 193, 220, 250, 275, 385, 487, 493,
499, 514, 656, 658, 783, 802, 852, 936, 957, 961

All now pass. Seeds 143, 383, 513, 558, 903, 951 also had this bug but now
time out due to the separate Category 3 issue (Playwright/Chrome hang).

---

## Category 2 (FIXED): Selection beyond text length in multi-context

### Symptoms

State mismatch in multi-context fuzz: the polyfill's `selectionStart` /
`selectionEnd` was clamped to `text.length`, while native Chrome preserved
the selection beyond `text.length`.

Failure rate before fix: ~4.5% (45/1000 in multi-context fuzz).

### Root Cause

`deleteWithExpansion()` in `src/edit-context-state.ts` clamped the final
selection position for backward selection deletes:

```typescript
// BUG: Math.min clamps to newText.length
const finalSel = wasBackward ? Math.min(origSelStart, newText.length) : deleteStart;
```

Chrome's native EditContext preserves `origSelStart` (the original
`selectionStart` value) for backward selection deletes, even when
`origSelStart` exceeds the new text length. The polyfill incorrectly
clamped this with `Math.min(origSelStart, newText.length)`.

### Example (multi seed 5, target2)

```
Step 2:  type("dx2")           -> text="dx2", sel=(3,3)
Step 3:  updateSelection(3, 0) -> sel=(3,0) -- backward selection
Step 6:  focusTarget1           -> target2 deactivated
Step 9:  focusTarget2           -> target2 reactivated
Step 10: press(Backspace)       -> deleteBackward on backward selection (3,0)
                                   Deletes range [0,3], text=""
                                   Native:   finalSel = origSelStart = 3 (preserved!)
                                   Polyfill: finalSel = Math.min(3, 0) = 0 (BUG)
Step 12: type("es")             -> Native:   inserts at 3, sel=5
                                   Polyfill: inserts at 0, sel=2
```

### Fix Applied

Removed the `Math.min` clamping in `deleteWithExpansion()` for backward
selections (`src/edit-context-state.ts`, line ~412):

```typescript
// Before:
const finalSel = wasBackward ? Math.min(origSelStart, newText.length) : deleteStart;

// After:
const finalSel = wasBackward ? origSelStart : deleteStart;
```

### Previously Failing Seeds (all now pass)

Multi-context fuzz: 5, 18, 35, 71

---

## Category 3 (FIXED): IME composition silently active during non-IME input

### Symptoms

IME fuzz tests fail with state mismatches, composition log divergences, or
event log mismatches when the sequence includes `imeSetComposition` followed
by regular `type()` calls. The polyfill's text or composition events differ
from native Chrome.

Failure rate before fix: ~7% (7/100 in IME fuzz, seeds 0-99).

### Root Cause

When regular keyboard input (`Input.dispatchKeyEvent`) arrives during an
active CDP IME composition (`Input.imeSetComposition`), Chrome's native
EditContext silently ends the composition internally — no `compositionend`
event fires on the element. The polyfill's textarea, however, never receives
a `compositionend` event from the browser (since CDP key dispatch bypasses
the IME pipeline), so the polyfill's EditContext state remained in
`composing=true` mode.

This caused `updateSelection()` to incorrectly trigger `cancelComposition`,
removing the composed text and firing a spurious `compositionend` event.

### Fix Applied

Two changes in `src/input-translator.ts` and `src/edit-context.ts`:

1. **`handleBeforeInput` in input-translator.ts**: When a non-composition
   `beforeinput` (e.g., `insertText`, `deleteContentBackward`) arrives while
   the EditContext is composing, call `_clearComposingSilently()` to end the
   composition without dispatching events — matching Chrome's silent behavior.

2. **Deferred compositionend in edit-context.ts**: `_clearComposingSilently()`
   stores the composed text in `#deferredCompositionEnd`. When `_blur()` or
   detach occurs, `_flushDeferredCompositionEnd()` dispatches the deferred
   `compositionend` event — matching Chrome's behavior of firing
   `compositionend` on blur/detach even if the composition was implicitly
   ended earlier.

### Previously Failing Seeds (all now pass)

IME fuzz: 46, 106, 118, 134, 146, 155, 196

---

## Category 4 (OPEN): Composition range persistence during non-IME input

### Symptoms

IME fuzz tests show incorrect compositionend data or extra compositionstart
events when non-IME input is typed during an active composition, and a new
`imeSetComposition` call follows.

Failure rate: ~3% (3/100 in IME fuzz, seeds 0-99).

### Root Cause

Chrome's native EditContext keeps the composition ACTIVE (with its range
intact) when non-IME keystrokes arrive via CDP. The composed text at the
composition range can be overwritten by subsequent insertions. When
compositionend finally fires (on blur/detach), its data reflects the current
text at the composition range — not the original composed text.

The polyfill silently clears the composing state (Category 3 fix), which
means:
1. The deferred compositionend data is captured at clear time (stale)
2. A subsequent `imeSetComposition` starts a NEW composition (extra
   compositionstart) instead of continuing the existing one

### Affected Seeds

IME fuzz: 6, 62, 72

### Fix Direction

Requires keeping the composition range active during non-IME input while
preventing `updateSelection` from cancelling the composition. This is a
significant refactoring of the composition state model (both pure state and
imperative shell). The `composing` flag would need to distinguish between
"IME-active" and "updateSelection-cancellable" states.

---

## Category 5 (OPEN): Playwright keyboard hang / timeout (non-polyfill)

### Symptoms

Tests time out at 30 seconds during `page.keyboard.press(action.key)` or
`page.keyboard.press(\`${modifier}+${key}\`)`. The hang occurs on the
**native Chrome page**, not the polyfill page. This is confirmed by the
stack trace pointing to the native page's action execution (line 81 of
fuzz.spec.ts, not line 82).

### Root Cause

This is a Chrome/Playwright infrastructure issue, not a polyfill bug.
Certain action sequences cause Chromium's input pipeline to enter a state
where Playwright's CDP-based keyboard dispatch never resolves. The common
pattern involves:

1. A `paste()` action (clipboard write + Ctrl+V), followed by
2. A `press(Delete)` or `press(Backspace)` some steps later, OR
3. Multiple rapid `updateText` calls that change text length significantly,
   followed by keyboard operations

The hang occurs on the native EditContext page before the polyfill page ever
receives the action. The sequences all contain clipboard operations or
complex `updateText` + `updateSelection` combinations that may trigger
edge cases in Chrome's native EditContext input handling.

### Affected Seeds

**Basic + shadow DOM fuzz** (identical seeds since they share the sequence
generator):
- 143, 383, 513, 558, 903, 951

**Multi-context fuzz**:
- 279, 306, 392

### Sequence Summaries

- **Seed 143**: `paste("a2")` at step 9, hangs at `press(Backspace)` step 15
- **Seed 383**: `paste(".e60pi")` at step 3, hangs at `press(Delete)` step 13
- **Seed 513**: No paste, but `updateText + updateSelection` combos with
  selection beyond text length, hangs at `click` step 19
- **Seed 558**: `paste("jl,a")` at step 7, hangs at `press(Delete)` step 13
- **Seed 903**: No paste, `updateText` + `updateSelection` beyond text, hangs
  at `type("bek")` step 15 or later
- **Seed 951**: `paste("kq")` at step 10, hangs at `type("54")` step 16

### Mitigation

These are not polyfill bugs. Possible mitigations:
- Add per-action timeouts in the fuzz harness to skip hung actions
- Skip test sequences known to contain Chrome/Playwright hang triggers
- Report upstream to Playwright if a minimal reproduction can be isolated

---

## Clamping Sites Verified Correct

These locations clamp selection or range values, and all are confirmed to
match Chrome's native behavior:

| Location | File | Behavior |
|----------|------|----------|
| `createState()` | `src/edit-context-state.ts:42-43` | Clamps initial selection to initial text length |
| `updateText()` | `src/edit-context-state.ts:146-147` | Clamps range to text.length (text only, no selection adjustment) |
| `updateSelection()` | `src/edit-context-state.ts:164-165` | Clamps start/end to text.length (matches Chrome) |
| `deleteWithExpansion()` | `src/edit-context-state.ts:387` | Clamps position for word/grapheme boundary lookup (internal only) |
| `syncFromEditContext()` | `src/input-translator.ts:110-115` | textarea.setSelectionRange naturally clamps; does NOT feed back to EditContext |
| `activate()` | `src/focus-manager.ts:208` | Calls syncFromEditContext; textarea clamping is cosmetic only |

### Sites intentionally NOT clamping (matches Chrome)

| Location | File | Behavior |
|----------|------|----------|
| `insertText()` | `src/edit-context-state.ts:299-300` | Uses raw selectionMin/Max; JS substring handles out-of-bounds gracefully |
| `commitText()` | `src/edit-context-state.ts:260-266` | Uses raw compositionRange or selectionMin/Max |
| `updateText()` selection | `src/edit-context-state.ts:150` | Never adjusts selection, even when text shrinks |

Note: `insertText()` and `commitText()` do not clamp selection to
`text.length` before computing insertion points. This matches Chrome's
behavior where inserting at a beyond-text position effectively appends.
The JavaScript `String.prototype.substring` handles out-of-bounds indices
gracefully (clamping internally), so the resulting text is correct. The
`textupdate` event reports the unclamped position, matching what Chrome does.
