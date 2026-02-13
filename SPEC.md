# EditContext Polyfill Implementation Spec

Derived from Chrome's `edit_context.cc` (Blink) and the [W3C EditContext spec](https://www.w3.org/TR/edit-context/).
This document captures every behavioral detail needed for a clean polyfill reimplementation.

## 1. Constructor

```
EditContext(init?: { text?, selectionStart?, selectionEnd? })
```

**Chrome behavior** (from `edit_context.cc` constructor):
- `text_` defaults to empty string
- `selectionStart` is clamped: `min(dict.selectionStart, text.length)`
- `selectionEnd` is clamped: `min(dict.selectionEnd, text.length)`

So `new EditContext({text: "ab", selectionStart: 5})` yields `selectionStart = 2`.

## 2. Properties

| Property | Type | Notes |
|----------|------|-------|
| `text` | `string` (readonly) | The text buffer |
| `selectionStart` | `uint32` (readonly) | Can be > selectionEnd (backward selection) |
| `selectionEnd` | `uint32` (readonly) | Can be < selectionStart |
| `characterBoundsRangeStart` | `uint32` (readonly) | Start of cached character bounds range |
| `isComposing` | `boolean` (readonly) | W3C spec; Chrome uses internal `has_composition_` |

**Important**: `selectionStart` can be greater than `selectionEnd`. This represents a backward selection. Chrome stores them as-is. The internal helpers `OrderedSelectionStart()` and `OrderedSelectionEnd()` return `min/max(start, end)` for operations that need ordered values.

## 3. updateText(rangeStart, rangeEnd, newText)

**Chrome behavior** (from `EditContext::updateText`):

```
1. If rangeStart > rangeEnd: swap them
2. end = min(rangeEnd, text.length)
3. start = min(rangeStart, end)
4. Compute selection adjustment (if no active composition):
   - If selectionStart >= end: selectionStart += delta
   - Else if selectionStart > start: selectionStart = start + newText.length
   - Same logic for selectionEnd
   (where delta = newText.length - (end - start))
5. If has active composition overlapping the update range:
   - If composition starts at or after end: shift composition range by delta
   - Else (overlap): cancel composition, re-adjust offsets
6. text = text[0..start] + newText + text[end..]
7. Apply adjusted selection
```

**Key details**:
- `updateText` does NOT fire a `textupdate` event (the app calls it, not the browser)
- `updateText` does NOT fire `compositionend` unless the update overlaps an active composition
- Selection adjustment is automatic when there's no composition
- When an active composition overlaps, Chrome cancels the composition (fires compositionend, removes composition text, then re-adjusts)

## 4. updateSelection(start, end)

**Chrome behavior** (from `EditContext::updateSelection`):

```
1. bound_start = min(start, text.length)
2. bound_end = min(end, text.length)
3. If has_composition AND (bound_start != current_selectionStart OR bound_end != current_selectionEnd):
   - Cancel composition (fires compositionend, removes composition text)
   - Re-clamp: bound_start = min(start, text.length), bound_end = min(end, text.length)
4. Set selection to (bound_start, bound_end)
5. If has_composition (still, after potential cancellation):
   - If composition range is (0,0): set it to (OrderedSelectionStart, OrderedSelectionEnd)
```

**Key details**:
- Selection values are clamped to `text.length`
- Changing selection during composition cancels the composition
- Does NOT fire textupdate event

## 5. Composition Lifecycle

This is the most complex part. Chrome's composition is driven by the OS input method controller, which calls these internal methods:

### 5a. SetComposition (IME typing)

Called when the IME updates the composition text. **This is what fires textupdate.**

```
1. If text is not empty AND has_composition is false:
   - Fire compositionstart event
   - Set has_composition = true
2. If text is empty:
   - If has_composition: cancel composition (OnCancelComposition)
   - Return
3. Determine replacement range:
   - If explicit replacement_range provided: use it
   - Else if composition_range is (0,0): use current selection range
   - Else: use current composition range
4. Replace text: text = text[0..range.start] + compositionText + text[range.end..]
5. Set selection to (range.start + localSelStart, range.start + localSelEnd)
6. Fire textupdate event with:
   - text: the composition text
   - updateRangeStart: replacement range start
   - updateRangeEnd: replacement range end
   - selectionStart: new global selection start
   - selectionEnd: new global selection end
7. Set composition_range = (range.start, range.start + compositionText.length)
8. Fire textformatupdate event
9. Fire characterboundsupdate event
```

### 5b. CommitText (IME commit / insertText)

Called when the IME commits final text (user picks a candidate or presses Enter).

```
1. Determine replacement range:
   - If explicit range: use it
   - Else if has_composition: use composition range
   - Else: use current selection range
2. Replace text: text = text[0..range.start] + commitText + text[range.end..]
3. Set selection to (range.start + commitText.length, range.start + commitText.length)
4. Fire textupdate event
5. If commitText is not empty AND has_composition:
   - Fire textformatupdate (with empty spans, clearing format)
   - Fire compositionend event with the committed text
6. Clear composition state
```

### 5c. InsertText (non-IME text insertion)

Called for direct text insertion (e.g., typing a character without IME).

```
1. Replace text at ordered selection: text = text[0..selStart] + insertText + text[selEnd..]
2. Set selection to (selStart + insertText.length, selStart + insertText.length)
3. Fire textupdate event with:
   - updateRangeStart: OrderedSelectionStart (before insertion)
   - updateRangeEnd: OrderedSelectionEnd (before insertion)
```

### 5d. OnCancelComposition

Called when composition is cancelled (e.g., pressing Escape, or updateSelection during composition).

```
1. Delete text in composition range: text = text[0..compStart] + text[compEnd..]
2. Set selection to (compStart, compStart)
3. Fire textupdate event with:
   - text: "" (empty)
   - updateRangeStart: compStart
   - updateRangeEnd: compEnd
4. Fire textformatupdate (empty spans)
5. Fire compositionend with empty string
6. Clear composition state (has_composition=false, ranges=0)
```

### 5e. FinishComposingText

Called when composition ends normally (blur, focus change).

```
1. If has_composition:
   - Extract text from composition range
   - Fire textformatupdate (empty spans)
   - Fire compositionend with the composition text
2. If selection_behavior is kDoNotKeepSelection:
   - Advance selection by text length
3. Clear composition state
```

## 6. Delete Operations

All delete operations follow the same pattern: expand selection if collapsed, then delete.

### DeleteBackward (Backspace)
```
1. If selection is collapsed: expand start backward by one grapheme cluster
2. Delete selection (see DeleteCurrentSelection)
```

### DeleteForward (Delete key)
```
1. If selection is collapsed: expand end forward by one grapheme cluster
2. Delete selection
```

### DeleteWordBackward (Ctrl+Backspace)
```
1. If selection is collapsed: expand start backward to word boundary
2. Delete selection
```

### DeleteWordForward (Ctrl+Delete)
```
1. If selection is collapsed: expand end forward to word boundary
2. Delete selection
```

### DeleteCurrentSelection
```
1. If selectionStart == selectionEnd: return (nothing to delete)
2. Remove text between OrderedSelectionStart and OrderedSelectionEnd
3. Fire textupdate with:
   - text: "" (empty)
   - updateRangeStart: OrderedSelectionStart
   - updateRangeEnd: OrderedSelectionEnd
   - selectionStart: OrderedSelectionStart
   - selectionEnd: OrderedSelectionStart
4. Set selection to (selectionStart, selectionStart)  [collapses to start]
```

**Key detail**: The textupdate event for deletion has `text: ""` and the range covers what was deleted.

## 7. Focus and Activation

### When EditContext becomes active
Chrome's `EditContext::Focus()`:
```
1. If there's already an active EditContext that isn't this one:
   - Finish its composition (FinishComposingText with kKeepSelection)
2. Set this as the active EditContext in the InputMethodController
```

### When EditContext becomes inactive
Chrome's `EditContext::Blur()`:
```
1. If this isn't the active EditContext: return
2. Finish composition (FinishComposingText with kKeepSelection)
3. Set active EditContext to null
```

### Activation triggers
The W3C spec's algorithm (3.1.9 "Determine the Active EditContext"):
```
1. Get the focused element
2. Walk up from the focused element through the DOM (including across shadow boundaries via getRootNode().host)
3. The first element with a non-null [[EditContext]] slot that is editable provides the active EditContext
```

**For the polyfill**: Focus on the element (via focus event) → activate. Blur → deactivate. The key is that deactivation MUST finish any active composition before clearing state.

## 8. Element Association

### Setting el.editContext = ec (the setter algorithm)
```
1. If element is not a valid shadow host name and not "canvas": throw NotSupportedError
2. If ec is not null:
   a. If ec is already associated with THIS element: return (no-op)
   b. If ec is already associated with ANOTHER element: throw NotSupportedError
3. Let oldEC = element's current EditContext
4. If oldEC is not null AND oldEC is the active EditContext:
   a. Deactivate oldEC (fires compositionend if composing)
5. If oldEC is not null: dissociate oldEC from element
6. If ec is not null: associate ec with element
7. Store ec in element's [[EditContext]] slot
```

### Setting el.editContext = null (detach)
Same algorithm with `ec = null`. Steps 4-5 handle cleanup.

**Key detail**: Detaching fires compositionend if there's an active composition. The deactivation algorithm sets `isComposing = false` and fires compositionend.

## 9. Event Dispatch Rules

### Events fired by Chrome native on the EditContext object:
| Event | When | Properties |
|-------|------|------------|
| `compositionstart` | First non-empty SetComposition call | `data: ""` (from W3C spec) |
| `compositionend` | CommitText, CancelComposition, FinishComposition, Deactivate | `data: composedText` |
| `textupdate` | SetComposition, CommitText, InsertText, Delete*, CancelComposition | See below |
| `textformatupdate` | SetComposition, CancelComposition (empty), CommitText (empty) | IME text spans |
| `characterboundsupdate` | SetComposition | range of composition |

### textupdate event properties:
- `updateRangeStart`: start of the range that was replaced
- `updateRangeEnd`: end of the range that was replaced (original, before replacement)
- `text`: the new text that was inserted (empty string for deletions)
- `selectionStart`: new selection start (global offset)
- `selectionEnd`: new selection end (global offset)

### Events NOT fired on the EditContext:
- `keydown`, `keyup` — these fire on the element, not the EditContext
- `beforeinput` — fires on the element; for EditContext-handled inputTypes, Chrome prevents default and handles internally
- `input` — NOT fired when EditContext is active (per W3C spec)
- `focus`, `blur` — fire on the element, not the EditContext

### Events on the associated element when EditContext is active:
- `keydown`, `keyup` — fire normally
- `beforeinput` — fires for ALL inputTypes, but:
  - EditContext-handled types (`insertText`, `deleteContentBackward`, etc.): Chrome prevents default on the beforeinput and handles it internally via textupdate
  - Non-handled types (`insertParagraph`, `insertFromPaste`, etc.): The app must handle these itself
- `compositionstart`, `compositionend` — do NOT fire on the element (only on EditContext)
- `input` — does NOT fire

### EditContext-handled inputType values:
- `insertText`
- `insertTranspose`
- `deleteWordBackward`
- `deleteWordForward`
- `deleteContent`
- `deleteContentBackward`
- `deleteContentForward`

All other inputTypes (insertParagraph, insertFromPaste, insertLineBreak, etc.) are NOT handled — the beforeinput fires on the element and the app handles it.

## 10. Bounds Methods

### updateControlBounds(rect)
Stores the bounding box of the editable region. Used by the OS to position IME windows. No-op for polyfill (IME positioning is native).

### updateSelectionBounds(rect)
Stores the bounding box of the current selection/caret. Used by the OS to position IME popup near the cursor. The polyfill can use this to position the hidden textarea.

### updateCharacterBounds(rangeStart, bounds[])
Stores per-character bounding boxes for the composition range. Used by the OS for per-character IME styling. The polyfill stores these but cannot use them for native IME positioning.

### characterBounds() / characterBoundsRangeStart
Returns the stored character bounds and their starting index. Pure getters.

### attachedElements()
Returns a frozen array containing the single associated element, or empty array.

## 11. Grapheme Cluster Boundaries

Chrome uses `BackwardGraphemeBoundaryStateMachine` and `ForwardGraphemeBoundaryStateMachine` for delete operations. These handle:
- Multi-byte UTF-16 characters (surrogate pairs)
- Combining characters (e.g., `e` + combining accent)
- Emoji sequences (ZWJ sequences, skin tone modifiers)

**For the polyfill**: Use `Intl.Segmenter` with `granularity: "grapheme"` (available in all target browsers) or fall back to simple codepoint-based boundaries.

## 12. Word Boundaries

Chrome uses `FindNextWordBackward` and `FindNextWordForward` from `text_boundaries.h`. These are platform-specific.

**For the polyfill**: Use `Intl.Segmenter` with `granularity: "word"` or a simple regex-based word boundary finder.

## 13. Internal State Summary

```
text_: string                          // The text buffer
selection_start_: uint32               // Can be > selection_end_ (backward)
selection_end_: uint32                 // Can be < selection_start_
has_composition_: bool                 // Active composition flag
composition_range_start_: uint32       // Start of composition in text
composition_range_end_: uint32         // End of composition in text
control_bounds_: Rect                  // Editable region bounds
selection_bounds_: Rect                // Selection/caret bounds
character_bounds_: Rect[]              // Per-char bounds for composition
character_bounds_range_start_: uint32  // Start index of character bounds
attached_elements_: Element[]          // Associated elements (max 1)
```

## 14. Polyfill Architecture Notes

The polyfill must bridge the gap between the browser's native input pipeline and the EditContext API. The key challenge is intercepting input that would normally go to a contenteditable/textarea and routing it through EditContext instead.

### Hidden textarea approach:
1. Attach a shadow root to the associated element
2. Place a hidden textarea inside the shadow root
3. Focus the textarea when the element is focused
4. Intercept textarea events and translate them to EditContext events:
   - `beforeinput:insertText` on textarea → compute diff → fire `textupdate` on EditContext
   - `beforeinput:deleteContentBackward` on textarea → let textarea mutate → diff → fire `textupdate`
   - `compositionstart` on textarea → fire `compositionstart` on EditContext
   - etc.
5. Forward keyboard events from textarea to element (via shadow DOM retargeting or synthetic dispatch)
6. Keep textarea value in sync with EditContext.text

### What the polyfill CANNOT replicate:
- `textformatupdate` events (requires OS IME integration)
- `characterboundsupdate` events (requires OS IME integration)
- `updateControlBounds()` effect (cannot position OS IME window)
- `isTrusted: true` on re-dispatched events
- `:focus` on `<canvas>` (no shadow root support; use `:focus-within`)

## 15. Composition Range Tracking (Critical Detail)

The composition range tracks which part of the text is currently being composed by the IME. This is the most error-prone part of the polyfill.

**Chrome's rules**:
1. Composition range starts at `(0, 0)` meaning "not yet set"
2. On first `SetComposition`: if range is `(0, 0)`, use current selection as the initial range
3. On subsequent `SetComposition`: replace the current composition range with new text
4. `composition_range_end = composition_range_start + compositionText.length` after each update
5. On `CommitText`: replace composition range (or selection if no composition) with final text
6. On cancel: delete text in composition range, set selection to composition start
7. On finish: keep text as-is, just clear composition state and fire compositionend

**Polyfill equivalent**: Track `compositionStart` and `compositionEnd` as the hidden textarea's composition progresses. The textarea's `compositionstart` sets the initial range from the current selection. Each `beforeinput:insertCompositionText` updates the range. `compositionend` clears it.
