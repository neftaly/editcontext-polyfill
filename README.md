# editcontext-polyfill

Polyfill for the [EditContext API](https://developer.mozilla.org/en-US/docs/Web/API/EditContext) ([caniuse](https://caniuse.com/mdn-api_editcontext)), a replacement for `contenteditable`.

This polyfill was written by a LLM (Claude Opus 4.6) using TDD & fuzzing, against Chrome's native EditContext implementation.
The test suite includes ports of the [Web Platform Tests](https://github.com/web-platform-tests/wpt/tree/master/editing/edit-context).

## Browser support

| Browser        | Support                        |
| -------------- | ------------------------------ |
| Chrome / Edge  | 121+ native (no polyfill)      |
| Firefox        | 125+ via polyfill              |
| Safari         | 15.4+ via polyfill             |

## Install

```sh
npm install @neftaly/editcontext-polyfill
```

Or via script tag:

```html
<script src="https://cdn.jsdelivr.net/gh/neftaly/editcontext-polyfill/dist/editcontext-polyfill.iife.js"></script>
```

By default, the polyfill is bypassed for browsers with native EditContext support. To force it on regardless:

```html
<script src="editcontext-polyfill.iife.js" data-force></script>
```

Or with the ESM API:

```js
import { install } from "@neftaly/editcontext-polyfill";
install({ force: true });
```

## Usage

```js
import "@neftaly/editcontext-polyfill";

const el = document.querySelector("#editor");
const ec = new EditContext({ text: "" });
el.editContext = ec;

ec.addEventListener("textupdate", (e) => {
  console.log(e.text, e.updateRangeStart, e.updateRangeEnd);
  // Re-render your editor view here
});

el.focus();
```

## Compatibility

This polyfill uses a hidden textarea for input capture. Most of the EditContext API works identically to Chrome's native implementation, with some exceptions.

### Unsupported features

- **`updateControlBounds()`** is a no-op. Logs a one-time warning in the IIFE build (warnings are removed from the ESM build at compile time).
- **CSS `:focus` on `<canvas>`** doesn't work (the hidden textarea is appended to `document.body`, not the canvas). Toggle a CSS class in your `focus`/`blur` handlers instead. All other elements support `:focus` via shadow DOM.
- **`isTrusted`** on re-dispatched events (keyboard, clipboard, composition) is `false`.

### Approximate features

- **`textformatupdate`** is dispatched during composition with a default format (solid thin underline over the full composition range). The polyfill cannot access OS-level IME format data, so individual clause styling is not available.
- **`characterboundsupdate`** is dispatched during composition for the full composition range. IME popups use `updateSelectionBounds()` position instead of per-character bounds.

### Architectural limitations

The hidden textarea architecture means some behaviors cannot match Chrome native:

- **IME composition + `updateSelection`**: If `updateSelection()` is called programmatically and then an IME composition begins immediately, the hidden textarea's cursor may not match the EditContext's selection, causing composition text to land at the wrong position. 
- **Sequential IME composition edge cases**: Rapid sequential `imeSetComposition` calls can occasionally desync the textarea's native IME tracking from the polyfill's internal state, causing intermediate composition text to not be fully replaced. The polyfill skips `textarea.value` sync during composition to mitigate this, but edge cases remain.
- **`compositionend.data` on blur**: When blur interrupts an active IME composition, Chrome's native `compositionend.data` behavior is inconsistent (sometimes empty string, sometimes the composed text). The polyfill may not match in all cases.

### Notes
- **Firefox insertLineBreak**: On `Enter` key, Firefox's normal `insertLineBreak` event is blocked. Instead, an `insertParagraph` event is fired, to match Chrome. `Shift+Enter` behaves the same (`insertLineBreak`).
- **Detach+reattach focus**: Setting `el.editContext = null` then `el.editContext = new EditContext()` across separate calls does not restore focus. Chrome retains element focus natively, but the polyfill loses it when the hidden textarea is destroyed on detach. Swapping contexts in a single call (`el.editContext = newCtx`) works correctly.

## Testing

- **`tests/unit/`** — pure unit tests for `EditContextState` transitions, runnable without a browser.
- **`tests/api/`** — deterministic tests for each EditContext method and event, run on both `chromium-native` and `chromium-polyfill`.
- **`tests/wpt/`** — ports of the [Web Platform Tests](https://github.com/web-platform-tests/wpt/tree/master/editing/edit-context) for EditContext.
- **`tests/fuzz/`** — seeded fuzzers (`pnpm test:fuzz`) that run the same random action sequence on Chrome native and the polyfill, then compare final state and event logs. Includes an IME composition fuzzer (`pnpm test:fuzz:ime`) that uses CDP `Input.imeSetComposition` via headed Chrome in Xvfb.

## TODO

- [x] Run IME fuzzer to verify `textformatupdate`/`characterboundsupdate` comparison against Chrome native — found and fixed `syncFromEditContext` disrupting composition state
- [x] Regression test: `updateSelection()` followed immediately by real IME input (CDP `imeSetComposition`) — `tests/api/ime-regression.spec.ts`
- [x] Firefox-specific workflow testing (select, type, blur, refocus, edit) — `tests/api/workflow.spec.ts` Firefox-specific tests + `pnpm test:workflow:firefox`
