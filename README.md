# editcontext-polyfill

Polyfill for the [EditContext API](https://developer.mozilla.org/en-US/docs/Web/API/EditContext) ([caniuse](https://caniuse.com/mdn-api_editcontext)), a replacement for `contenteditable`.

This polyfill was written by a LLM (Claude Opus 4.6) using TDD & fuzzing, against Chrome's native EditContext implementation.
The test suite includes ports of the [Web Platform Tests](https://github.com/web-platform-tests/wpt/tree/master/editing/edit-context).

## Browser support

| Browser        | Support                        |
| -------------- | ------------------------------ |
| Chrome / Edge  | 121+ native (no polyfill)      |
| Firefox        | 90+ via polyfill               |
| Safari         | 14.1+ via polyfill             |

The polyfill requires ES2022 (private class fields).

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

Scripts cannot style individual IME composition characters, position IME popups per-character, or inform the OS of the editor's bounding box.       
Calling these unsupported features log a one-time warning in development builds (`process.env.NODE_ENV !== "production"`).

- **`textformatupdate`** is never dispatched. Underline the full composition range as a fallback for IME styling.
- **`characterboundsupdate`** is never dispatched. IME popups use `updateSelectionBounds()` position instead of per-character bounds.
- **`updateControlBounds()`** is a no-op.
- **CSS `:focus` on `<canvas>`** doesn't work. Use `:focus-within` instead. All other elements support `:focus`.
- **`isTrusted`** on re-dispatched events (keyboard, clipboard, composition) is `false`.

### Architectural limitations

The hidden textarea architecture means some behaviors cannot match Chrome native:

- **IME composition + `updateSelection`**: If `updateSelection()` is called programmatically and then an IME composition begins immediately, the hidden textarea's cursor may not match the EditContext's selection, causing composition text to land at the wrong position. 
- **Sequential IME composition edge cases**: Rapid sequential `imeSetComposition` calls can occasionally desync the textarea's native IME tracking from the polyfill's internal state, causing intermediate composition text to not be fully replaced. The polyfill skips `textarea.value` sync during composition to mitigate this, but edge cases remain.
- **`compositionend.data` on blur**: When blur interrupts an active IME composition, Chrome's native `compositionend.data` behavior is inconsistent (sometimes empty string, sometimes the composed text). The polyfill may not match in all cases.

### Notes
- **IME popup positioning**: `updateSelectionBounds()` is not positioned pixel-perfect (~1px precision).
- **Firefox insertLineBreak**: On `Enter` key, Firefox's normal `insertLineBreak` event is blocked. Instead, an `insertParagraph` event is fired, to match Chrome. `Shift+Enter` behaves the same (`insertLineBreak`).
- **Detach+reattach focus**: Setting `el.editContext = null` then `el.editContext = new EditContext()` across separate calls does not restore focus. Chrome retains element focus natively, but the polyfill loses it when the hidden textarea is destroyed on detach. Swapping contexts in a single call (`el.editContext = newCtx`) works correctly.

## Testing

- **`tests/api/`** — deterministic tests for each EditContext method and event, run on both `chromium-native` and `chromium-polyfill`.
- **`tests/wpt/`** — ports of the [Web Platform Tests](https://github.com/web-platform-tests/wpt/tree/master/editing/edit-context) for EditContext.
- **`tests/fuzz/`** — seeded fuzzers (`pnpm test:fuzz`) that run the same random action sequence on Chrome native and the polyfill, then compare final state and event logs. Includes an IME composition fuzzer (`pnpm test:fuzz:ime`) that uses CDP `Input.imeSetComposition` via headed Chrome in Xvfb.
