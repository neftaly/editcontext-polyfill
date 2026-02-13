# Test Plan for EditContext Polyfill Reimplementation

Assumes all existing polyfill source code, tests, and fuzzers will be deleted. Start fresh from SPEC.md.

## Philosophy

**Chrome-only comparison.** Both test targets run on Chrome:
1. `chromium-native` — Chrome's native EditContext (the reference implementation)
2. `chromium-polyfill` — polyfill loaded on Chrome (native EditContext deleted via `addInitScript`)

This eliminates browser input pipeline differences as a variable. Same browser, same events, same IME behavior. The only difference is polyfill code vs native code. Firefox/Safari compat is a separate layer handled later.

**One fuzzer, not three.** The spec tells us what to test deterministically. The single fuzzer is a safety net for edge case interactions.

**Spec-driven deterministic tests first.** Every behavior in SPEC.md gets a deterministic test.

## Test Structure

```
tests/
  api/                      # Deterministic spec-compliance tests
    constructor.spec.ts     # Constructor clamping, defaults
    update-text.spec.ts     # updateText behavior, range swapping, selection adjustment
    update-selection.spec.ts # updateSelection clamping, composition cancellation
    composition.spec.ts     # Full composition lifecycle (CDP for both native and polyfill)
    delete.spec.ts          # DeleteBackward/Forward/WordBackward/WordForward
    insert-text.spec.ts     # InsertText (non-IME typing)
    events.spec.ts          # textupdate event properties, dispatch order
    focus.spec.ts           # Activation/deactivation, composition cleanup on blur
    element-binding.spec.ts # editContext setter/getter, detach, reassignment errors
    bounds.spec.ts          # updateControlBounds, updateSelectionBounds, updateCharacterBounds
  wpt/                      # Web Platform Tests (existing ports, keep)
    input.spec.ts
  fuzz/                     # Single fuzzer
    fuzz.spec.ts
    sequence-generator.ts
    helpers.ts
```

## Playwright Config

```typescript
// Two Chrome projects, same browser, different EditContext source
const projects = [
  {
    name: "chromium-native",
    use: { ...devices["Desktop Chrome"] },
  },
  {
    name: "chromium-polyfill",
    use: {
      ...devices["Desktop Chrome"],
      // Delete native EditContext before polyfill loads
      // (addInitScript in test fixtures or global setup)
    },
  },
];
```

Each `chromium-polyfill` page gets an `addInitScript` that:
1. Deletes `window.EditContext`, `window.TextUpdateEvent`, etc.
2. Loads the polyfill bundle (which auto-installs since native is gone)

## Layer 1: API Spec Tests (tests/api/)

Each test runs on both `chromium-native` and `chromium-polyfill`. Tests assert identical behavior on both.

### constructor.spec.ts
- Default constructor: text="", selectionStart=0, selectionEnd=0
- Constructor with text: preserves text
- Constructor with selectionStart > text.length: clamps to text.length
- Constructor with selectionEnd > text.length: clamps to text.length
- Constructor with all args in range: preserves exact values

### update-text.spec.ts
- Basic replacement: updateText(0, 3, "xyz") on "abcdef"
- Insertion: updateText(2, 2, "XY") (zero-width range)
- Deletion: updateText(1, 3, "")
- rangeStart > rangeEnd: swapped silently
- rangeEnd > text.length: clamped
- rangeStart > text.length: clamped to text.length (which equals clamped end)
- Selection adjustment when selection is after update range
- Selection adjustment when selection overlaps update range
- Selection adjustment when selection is before update range (no change)
- updateText during composition that overlaps composition range: cancels composition
- updateText during composition that precedes composition range: shifts composition range
- updateText does NOT fire textupdate event

### update-selection.spec.ts
- Basic: updateSelection(2, 5) sets both values
- Backward selection: updateSelection(5, 2) preserves order (start > end)
- Clamping: updateSelection(100, 200) on 5-char text → (5, 5)
- During composition: changing selection cancels composition (fires compositionend)
- updateSelection does NOT fire textupdate event

### composition.spec.ts
**CDP `Input.imeSetComposition` / `Input.insertText` for both native and polyfill** — same IME pipeline, clean comparison.

- Start composition: fires compositionstart on EditContext (not element)
- Composition update: fires textupdate with correct range
- Composition commit: fires textupdate + compositionend
- Multi-step composition: each step updates composition range correctly
- Cancel composition: deletes composition text, fires textupdate(""), compositionend("")
- Detach during composition: fires compositionend
- Blur during composition: fires compositionend (via FinishComposingText)
- compositionstart NOT fired on element (only on EditContext)
- compositionend NOT fired on element (only on EditContext)

### delete.spec.ts
- Backspace with collapsed selection: deletes one grapheme backward
- Backspace with range selection: deletes selection
- Delete with collapsed selection: deletes one grapheme forward
- Delete with range selection: deletes selection
- Ctrl+Backspace: deletes word backward
- Ctrl+Delete: deletes word forward
- All fire textupdate with text="" and correct range
- Grapheme cluster handling: backspace over emoji/combining chars deletes whole cluster

### insert-text.spec.ts
- Single character insertion
- Multi-character insertion
- Insertion replaces selection (when selection is non-collapsed)
- textupdate range is (OrderedSelectionStart, OrderedSelectionEnd)
- Selection moves to end of inserted text

### events.spec.ts
- textupdate: verify all properties (updateRangeStart, updateRangeEnd, text, selectionStart, selectionEnd)
- Event order for single char: keydown → beforeinput:insertText → textupdate → keyup
- Event order for backspace: keydown → beforeinput:deleteContentBackward → textupdate → keyup
- Event order for Enter: keydown → beforeinput:insertParagraph → keyup (no textupdate)
- beforeinput on element for EditContext-handled types: fires but default is prevented
- beforeinput on element for non-handled types: fires, app must handle
- input event does NOT fire on element when EditContext is active
- compositionstart/end fire on EditContext, not on element

### focus.spec.ts
- Focus element → EditContext becomes active
- Blur element → EditContext deactivated
- Deactivation during composition → compositionend fires
- Focus element A, then focus element B (both with EditContexts) → A deactivated, B activated
- Tab away → deactivation
- Focus other element → deactivation
- Detach editContext from focused element → deactivation

### element-binding.spec.ts
- Set editContext on valid element (div, span, etc.)
- Set editContext on canvas
- Set editContext on invalid element (e.g., input) → NotSupportedError
- Set same editContext to two elements → NotSupportedError
- Set null to detach
- Set editContext that's already on this element → no-op
- attachedElements() returns [element] when bound, [] when not
- Detach from focused element → deactivation

### bounds.spec.ts
- updateControlBounds stores value, retrievable (if exposed)
- updateSelectionBounds stores value
- updateCharacterBounds stores array
- characterBounds() returns stored DOMRect array
- characterBoundsRangeStart returns stored start

## Layer 2: Web Platform Tests (tests/wpt/)

Keep existing WPT ports. These are the official test suite.

## Layer 3: Single Fuzzer (tests/fuzz/)

**One fuzzer.** Runs same random input sequence on `chromium-native` and `chromium-polyfill`. Compares:
1. Final state (text, selectionStart, selectionEnd) — the primary check
2. textupdate event log — secondary check (same sequence of mutations)

### Fuzzer action vocabulary:
- `type(text)` — keyboard typing via Playwright
- `press(key)` — single key press
- `pressCombo(key, modifiers)` — modifier combos
- `updateText(start, end, text)` — API call
- `updateSelection(start, end)` — API call
- `imeCompose(steps, commit)` — CDP `Input.imeSetComposition` + `Input.insertText`
- `imeComposeThenDetach(steps)` — composition interrupted by detach
- `detach` — set editContext = null
- `reattach(init?)` — set editContext = new EditContext(init)
- `focus` / `blur` / `focusOther`
- `execCommand(command)` — document.execCommand

### Key advantage of Chrome-only fuzzing:
- IME composition uses CDP for both targets — same code path, clean comparison
- No need for synthetic composition events (which were the source of all previous divergences)
- No Firefox input pipeline quirks to work around

### Fuzzer configuration:
- `FUZZ_ITERATIONS` (default 50)
- `FUZZ_SEED_OFFSET` (for parallel runs)
- `FUZZ_TIMEOUT` (default 180s)
- Runs in container via docker (browsers need system deps)

## Test Execution

```bash
# All deterministic tests (container):
pnpm test:container

# Fuzz only (container):
pnpm test:fuzz

# Quick API test on native only (verify test correctness):
pnpm test:chrome
```

## What NOT to Test

- `textformatupdate` / `characterboundsupdate` events (polyfill can't implement these)
- `updateControlBounds` effect (no OS IME integration)
- Pixel-perfect IME popup positioning
- `isTrusted` on events (always false in polyfill, by definition)
- Multiple EditContexts on different elements simultaneously (future spec, not implemented)
- iframe-hosted EditContexts (different browsing context)
- Firefox/Safari-specific input event quirks (separate compat layer, later)

## Test Doubles / Utilities

### CDP helper for composition (used by both targets)
```typescript
async function imeCompose(cdp: CDPSession, steps: string[], commit: string) {
  for (const step of steps) {
    await cdp.send("Input.imeSetComposition", {
      text: step, selectionStart: step.length, selectionEnd: step.length
    });
  }
  await cdp.send("Input.insertText", { text: commit });
}
```

### Event recorder
```typescript
// Attach to both EditContext and element, record event log
// Format: "ec.textupdate:0-3:xyz:sel=3,3", "el.keydown:a", etc.
```

These utilities are shared between the deterministic tests and the fuzzer.

## Future: Firefox/Safari Compat Layer

Once the polyfill passes all Chrome-vs-Chrome tests:
1. Add `firefox-polyfill` and `webkit-polyfill` Playwright projects
2. Run deterministic API tests on those browsers
3. Fix input event normalization issues (insertLineBreak, doubled Unicode, etc.)
4. These fixes go in a browser-compat normalization layer, separate from core logic
