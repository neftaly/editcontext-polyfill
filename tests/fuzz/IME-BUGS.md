# IME Composition Fuzzer Bugs

Found by `fuzz-ime.spec.ts` — 26/30 seeds failed (4 passed: 3, 9, 10, 25).
~4,000 seeds run overnight confirmed the same 5 bugs at a steady ~84% failure rate.

## Bug 1: Spurious `insertCompositionText` beforeinput events

**Seeds**: 0, 2, 8, 11, 13, 14, 15, 18, 22, 23, 26, 27, 28

The polyfill fires `beforeinput` events with `inputType: "insertCompositionText"` during IME composition. Native EditContext does **not** fire these — it handles composition internally through `compositionstart`/`compositionend` and `textupdate` events only.

- `imeSetComposition("X")` -> polyfill emits `{data: "X", inputType: "insertCompositionText"}`, native emits nothing
- `imeCommitText("Y")` -> polyfill emits `{data: "Y", inputType: "insertCompositionText"}`, native emits nothing
- `imeCancelComposition()` -> polyfill emits `{data: "", inputType: "insertCompositionText"}`, native emits nothing

**Minimal reproduction (seed 2)**:
```
0-14: typing and deleting (no IME)
  15: imeSetComposition("んら", 2, 2)
  16: imeCommitText("いり")
17-19: updateText, press(Control+Delete), detach
```

**Root cause**: The polyfill's hidden textarea receives native `beforeinput` events with `inputType: "insertCompositionText"` from the browser's IME pipeline. In `input-translator.ts:153`, composition events are excluded from forwarding (`!isComposition`), but this only prevents forwarding — it doesn't prevent the *recording* of these events by test listeners attached to the EditContext's element. The real issue is architectural: CDP `imeSetComposition` drives the textarea's native IME, which fires `beforeinput:insertCompositionText` on the textarea. In shadow DOM mode, these bubble to the host element. Native EditContext never fires these on the element at all because it intercepts composition at a lower level (before `beforeinput` is dispatched). The polyfill cannot suppress events that bubble through shadow DOM without `stopPropagation`, but it currently only stops propagation for non-composition, non-suppressed types (`input-translator.ts:155`). The composition `beforeinput` is `preventDefault`'d (`input-translator.ts:174`) but NOT `stopPropagation`'d, so it reaches the element.

**Fix direction**: Add `event.stopPropagation()` before `event.preventDefault()` in the composition branch (`input-translator.ts:173-174`), same as the existing pattern for non-composition types at line 155. For non-shadow mode (canvas), composition beforeinput events already don't reach the element because the textarea is detached from the element's DOM tree.

## Bug 2: `compositionstart.data` is `""` instead of first composition text

**Seeds**: 1, 4, 7, 21

Native fires `compositionstart` with `data` set to the initial composition string. The polyfill fires it with `data: ""`.

**Minimal reproduction (seed 4)**:
```
0: press(Backspace)
1: imeSetComposition("ね", 1, 1)
2: imeSetComposition("へみやち", 4, 4)
3: imeCancelComposition()
```
Native: `compositionstart.data = "ね"`. Polyfill: `compositionstart.data = ""`.

**Root cause**: In `edit-context.ts:204-206`, `_setComposition` fires `compositionstart` with hardcoded empty string:
```typescript
if (text !== "" && !this.#hasComposition) {
  this.#dispatchCompositionStart("");  // <-- always ""
  this.#hasComposition = true;
}
```
The `text` parameter (the first composition string, e.g. `"ね"`) is available but not passed to `#dispatchCompositionStart`.

**Fix direction**: Change line 205 from `this.#dispatchCompositionStart("")` to `this.#dispatchCompositionStart(text)`.

## Bug 3: `insertFromPaste` beforeinput has paste text instead of `null`

**Seeds**: 0, 17, 18, 20, 22, 23, 26, 27, 28

Native fires `beforeinput` with `{data: null, inputType: "insertFromPaste"}`. The polyfill fires `{data: "<pastedText>", inputType: "insertFromPaste"}`.

**Minimal reproduction (seed 20)**:
```
 0-13: setup (type, focus, detach/reattach)
   14: paste("haptv")
15-19: type, press, etc.
```
Native: `{data: null}`. Polyfill: `{data: "haptv"}`.

**Note**: This is not IME-specific — it also affects the non-IME fuzzer but was masked because paste sequences happen to pass in most seeds there. Should be fixed independently.

**Root cause**: In `input-translator.ts:66-79`, `createSyntheticBeforeInput` copies `event.data` from the original textarea beforeinput:
```typescript
const init: InputEventInit = {
  inputType,
  data: event.data,  // <-- copies the paste text
  ...
};
```
For `insertFromPaste`, the textarea's native `beforeinput` has `data` set to the pasted text (browser puts it there). But Chrome's native EditContext fires `insertFromPaste` on the element with `data: null` — the paste data is only available via `event.dataTransfer`, not `event.data`.

**Fix direction**: In `createSyntheticBeforeInput` (or at the forwarding call site), set `data: null` when `inputType` is `"insertFromPaste"` or `"insertFromDrop"`. The `dataTransfer` property is already forwarded correctly at line 77.

## Bug 4: State mismatch after `updateSelection` + editing

**Seeds**: 5, 6, 12, 16, 19

After programmatic `updateSelection` (especially reversed/backward ranges) combined with subsequent editing, the polyfill ends up with different text content or cursor position than native.

**Sub-patterns**:
- **Backward selection** (seed 12, 16): `updateSelection(1, 0)` followed by `press(Backspace)` deletes the wrong range
- **updateText while blurred** (seed 5): `updateText(2, 0, "l8")` while blurred, then focus + click + typing — cursor placed incorrectly
- **IME + selection** (seed 19): `updateSelection(8, 9)` followed by IME composition — replacement applied to wrong range
- **Detach/reattach + updateSelection** (seed 6): after IME, detach/reattach, then `updateSelection(0, 0)` + focus — polyfill loses text

**Minimal reproduction (seed 12)**:
```
0: type("a")
1: imeSetComposition("えも", 2, 2)
2: imeCommitText("えも")
3: updateSelection(1, 0)
4: press(Backspace)
```
Native: `"aえも"`. Polyfill: `"えもa"`.

**Root cause**: This is a textarea sync issue. When `updateSelection(1, 0)` is called, `edit-context.ts:170` sets the internal selection to `(1, 0)` (backward). But the textarea is not synced — `updateSelection` doesn't call `_onStateChange` or trigger `syncFromEditContext`. So when `press(Backspace)` arrives, the textarea's selection is still at the old position (end of text after commit). The `beforeinput:deleteContentBackward` fires based on the textarea's stale selection, and `_deleteBackward` in the EditContext uses the *internal* selection `(1, 0)` which has `#orderedSelectionStart() = 0`, `#orderedSelectionEnd() = 1`. This deletes the first character `"a"` and produces `"えも"`. But native Chrome, receiving `Backspace` with cursor after the committed text, deletes the last character of `"えも"`.

Wait — the output says native = `"aえも"` (no deletion?) and polyfill = `"えもa"`. That suggests the issue is even more fundamental: the polyfill has the text in the wrong order. After `imeCommitText("えも")`, the text should be `"aえも"` with cursor at end (position 3). `updateSelection(1, 0)` sets backward selection from 1 to 0 (selecting `"a"`). `Backspace` with a selection deletes the selection. Native deletes `"a"` -> `"えも"`. But the polyfill ends up with `"えもa"` which means the committed text was placed *before* `"a"` instead of after.

The deeper issue: CDP `imeSetComposition` / `imeCommitText` on native EditContext operates at the browser level and correctly inserts at the cursor position (after `"a"`). But in the polyfill, the hidden textarea might have its cursor at position 0 (start) when the composition begins, because `type("a")` put the cursor at 1, but then the textarea wasn't properly synced before the CDP composition events arrive. The CDP events go through the textarea's native IME pipeline, and the textarea's selection determines where composition text is placed — if the textarea selection is wrong, the composition text lands in the wrong place.

**Fix direction**: Ensure `syncFromEditContext` is called after any programmatic state change (`updateSelection`, `updateText`) that could affect subsequent input. Currently these methods update internal state but don't sync the textarea. The `_onStateChange` callback (which triggers sync) is only called from `#dispatchTextUpdate`, not from `updateSelection` or `updateText`.

## Bug 5: Sequential `imeSetComposition` calls don't replace intermediate text

**Seeds**: 24, 29

When multiple `imeSetComposition` calls occur in succession, the polyfill doesn't properly replace intermediate composition text — old composition leaks into the final text.

**Minimal reproduction (seed 29)**:
```
0: type("jp")
1: press(Backspace)
2: type("ax2")
3: press(Control+Delete)
4: imeSetComposition("らも", 2, 2)
5: imeSetComposition("おせえ", 3, 3)
6: imeSetComposition("したく", 3, 3)
7: imeSetComposition("そるも", 3, 3)
8: imeCommitText("ら")
```
Native: `"jax2ら"`. Polyfill: `"jax2おせえら"`. Step 5's `"おせえ"` was not replaced by steps 6-7.

**Root cause**: Same textarea sync issue as Bug 4, manifesting in composition. `_setComposition` at `edit-context.ts:219-226` determines the replacement range from `#compositionRangeStart`/`#compositionRangeEnd`. This is correct for the EditContext's internal state. But because CDP `imeSetComposition` drives the *textarea's* native IME, the textarea also has its own composition state. After each `_setComposition` call, `syncFromEditContext()` is called (`input-translator.ts:180`) which sets `textarea.value` and `textarea.setSelectionRange`. But setting `textarea.value` during an active composition may disrupt the textarea's native composition tracking. The textarea may then apply the next `imeSetComposition` at a stale position, leading to `beforeinput:insertCompositionText` with the new text being inserted at the wrong range instead of replacing the previous composition.

Specifically, after step 4 (`"らも"`), the internal composition range is `[4, 6]`. `syncFromEditContext` sets `textarea.value = "jax2らも"`. Step 5 (`"おせえ"`) arrives as a `beforeinput:insertCompositionText` on the textarea. The polyfill calls `_setComposition("おせえ", 3, 3)` which replaces `[4, 6]` with `"おせえ"` -> `"jax2おせえ"`, range now `[4, 7]`. Then `syncFromEditContext` sets `textarea.value = "jax2おせえ"`. But this `textarea.value` assignment may break the browser's composition tracking, causing step 6's `beforeinput` to not fire at all (the browser thinks composition was cancelled by the value change). Without the `beforeinput`, `_setComposition` is never called for steps 6-7, leaving `"おせえ"` in place. Step 8's `imeCommitText` then calls `Input.insertText` via CDP, which fires `beforeinput:insertText` (not `insertCompositionText`), inserting `"ら"` at the textarea's cursor position rather than replacing the composition range.

**Fix direction**: This is the fundamental challenge of the hidden textarea approach. Setting `textarea.value` during composition disrupts the browser's native composition state. The fix may require:
1. Not syncing `textarea.value` during active composition (only sync selection)
2. Letting the textarea's native composition handle the text mutations, and only reading the result on `compositionend`
3. Or tracking a "dirty" flag during composition and deferring the full sync until composition ends

## Summary

| Bug | Pattern | Failure type | Count | Fix | Status |
|-----|---------|-------------|-------|-----|--------|
| 1 | Spurious `insertCompositionText` beforeinput | beforeinput log | 13 | `stopPropagation` in composition branch | **Fixed** |
| 2 | `compositionstart.data` empty | composition log | 4 | Pass `text` to `#dispatchCompositionStart` | **Fixed** |
| 3 | `insertFromPaste` data not null | beforeinput log | 9 | Null out `data` for paste/drop in `createSyntheticBeforeInput` | **Fixed** |
| 4 | `updateSelection`/`updateText` cursor mismatch | state | 5 | `_onStateChange` in `updateText` + backward selection cursor fix | **Mostly fixed** |
| 5 | Composition text not replaced | state | 2 | Skip `textarea.value` sync during composition | **Mostly fixed** |

### Fix details

**Bug 4 fixes** (`edit-context.ts`):
- Added `_onStateChange?.()` to `updateText` so the textarea syncs after programmatic text changes.
- Added backward selection cursor correction to all delete methods (`_deleteBackward`, `_deleteForward`, `_deleteWordBackward`, `_deleteWordForward`). Chrome places the cursor at `min(originalSelectionStart, newTextLength)` after deleting a backward selection, not at `ordStart`.

**Bug 5 fix** (`input-translator.ts`):
- Skip `textarea.value` assignment in `syncFromEditContext` when `editContext.isComposing` is true. This avoids disrupting the browser's native IME composition tracking.

### Current fuzzer results (after all fixes)

- **IME fuzzer (30 seeds)**: 27 passed, 3 stable failures (seeds 13, 19, 24)
- **Non-IME fuzzer (30 seeds)**: 28 passed, 2 stable failures (seeds 3, 8)

### Remaining failures

- **Seed 13** (IME): `compositionend.data` mismatch when blur interrupts composition — native sometimes fires empty data, polyfill fires composed text. Native behavior appears inconsistent across sequences.
- **Seed 19** (IME): Textarea cursor desync after `updateSelection` followed by composition — the textarea doesn't match the EditContext's selection when CDP `imeSetComposition` arrives, causing composition text to land in the wrong position.
- **Seed 24** (IME, flaky): Composition text not fully replaced during sequential `imeSetComposition` calls — edge case of Bug 5 where the textarea's native IME state desyncs.
- **Seeds 3, 8** (non-IME): Text content divergence from complex sequences involving `updateSelection`, `execCommand(forwardDelete)`, and edge cases in text deletion.

Many seeds exhibit multiple bugs. Seeds that fail at state mismatch may also have beforeinput/composition bugs that aren't reached.
