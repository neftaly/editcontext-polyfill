# editcontext-polyfill

Polyfill for the [EditContext API](https://developer.mozilla.org/en-US/docs/Web/API/EditContext) ([caniuse](https://caniuse.com/mdn-api_editcontext)), a replacement for `contenteditable`.

The implementation is tested against Chrome's native EditContext behavior where native comparison is useful, with Web Platform Test ports and seeded fuzzers covering higher-risk editing paths.

## Browser support

| Browser        | Support                                      |
| -------------- | -------------------------------------------- |
| Chrome / Edge  | 121+ native; polyfill when native EditContext is absent |
| Firefox        | Modern Firefox via polyfill                  |
| Safari         | Safari 17+ via polyfill                      |

## Install

```sh
npm install @neftaly/editcontext-polyfill
```

Or via script tag:

```html
<script src="https://cdn.jsdelivr.net/npm/@neftaly/editcontext-polyfill@latest/dist/editcontext-polyfill.iife.js"></script>
```

By default, the polyfill is bypassed for browsers with native EditContext support. To force it on regardless:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@neftaly/editcontext-polyfill@latest/dist/editcontext-polyfill.iife.js"
  data-force
></script>
```

Or with the ESM API:

```js
import { install } from "@neftaly/editcontext-polyfill";
install({ force: true });
```

## Usage

Use the host element as the accessible editing control:

```html
<div
  id="editor"
  role="textbox"
  aria-label="Document body"
  aria-multiline="true"
  tabindex="0"
></div>
```

```js
import "@neftaly/editcontext-polyfill";

const el = document.querySelector("#editor");
const ec = new EditContext({ text: "" });
el.editContext = ec;

function render() {
  el.textContent = ec.text;
}

ec.addEventListener("textupdate", (e) => {
  ec.updateSelection(e.selectionStart, e.selectionEnd);
  render();
});

render();
el.focus();
```

EditContext is a low-level editing primitive. Native Chromium does not update
`selectionStart` / `selectionEnd` for navigation keys such as `ArrowLeft`,
`ArrowRight`, `Home`, or `End`; it dispatches keyboard events and expects the
editor to decide how selection should move. Listen for `keydown` and
`selectionchange`, map between DOM positions and your text model, call
`ec.updateSelection(start, end)`, and rerender the visible caret or selection.
The polyfill follows the same contract and forwards keyboard events to the host
element.

## Frameworks

The `createEditContext` helper handles setup and teardown in a single call, returning a cleanup function that fits naturally into framework lifecycle hooks. It only attaches the EditContext and wires callbacks; your component still renders text, owns keyboard/selection behavior, and provides host semantics.

```jsx
// React
import { createEditContext } from "@neftaly/editcontext-polyfill";

useEffect(() => {
  if (!ref.current) return;
  return createEditContext(ref.current, {
    text: "",
    onTextUpdate(e) { /* update state and call updateSelection */ },
  });
}, []);
```

```js
// Vue 3
import { createEditContext } from "@neftaly/editcontext-polyfill";

onMounted(() => {
  const destroy = createEditContext(el.value, { /* ... */ });
  onUnmounted(destroy);
});
```

```svelte
<!-- Svelte 5 -->
<script>
  import { createEditContext } from "@neftaly/editcontext-polyfill";

  let el;

  $effect(() => {
    if (!el) return;
    return createEditContext(el, { /* ... */ });
  });
</script>
```

```jsx
// Solid
import { createEditContext } from "@neftaly/editcontext-polyfill";

onMount(() => {
  const destroy = createEditContext(ref, { /* ... */ });
  onCleanup(destroy);
});
```

## Accessibility

EditContext is a low-level editing primitive; it does not make a generic element accessible by itself. Give the host element the role, accessible name, focusability, and keyboard behavior your editor needs. For most multiline custom editors, that means `role="textbox"`, an accessible name from `aria-label` or `aria-labelledby`, `aria-multiline="true"`, and `tabindex="0"`.

Use `aria-multiline="true"` only for multiline editors. If the host already has more specific semantics, keep those semantics. The polyfill intentionally does not assign or overwrite `role`, `aria-label`, `aria-labelledby`, `aria-describedby`, or `aria-multiline` on arbitrary host elements.

The hidden textarea is input plumbing and is kept out of the accessibility tree. Screen readers depend on the host element and your rendered editor DOM, so render text in the DOM where possible and provide app-level keyboard navigation and selection behavior. Canvas-only editors need a separate accessible surface or should document the limitation; the polyfill cannot emulate native platform text selection announcements for arbitrary custom renderers.

## Performance

CDP profiling is available with `pnpm test:perf`. The benchmark reports typing latency, DOM/layout churn, forced-GC heap pressure, CDP DOM counters, bundle size context, programmatic `updateText`/`updateSelection` throughput, and `updateCharacterBounds()`/`characterBounds()` copy pressure for Chromium native and polyfill projects. Treat the numbers as release context rather than CI thresholds.

Bundle size budgets are enforced by `pnpm size` from `scripts/size-budget.json`: ESM <= 11.3 KiB brotli, IIFE <= 11.8 KiB brotli, and combined JS bundles <= 23.1 KiB brotli.

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
- **Sequential IME composition edge cases**: Rapid sequential `imeSetComposition` calls can occasionally desync the textarea's native IME tracking from the polyfill's tracked state, causing intermediate composition text to not be fully replaced. The polyfill skips `textarea.value` sync during composition to mitigate this, but edge cases remain.
- **`compositionend.data` on blur**: When blur interrupts an active IME composition, Chrome's native `compositionend.data` behavior is inconsistent (sometimes empty string, sometimes the composed text). The polyfill may not match in all cases.

### Notes
- **Firefox insertLineBreak**: On `Enter` key, Firefox's normal `insertLineBreak` event is blocked. Instead, an `insertParagraph` event is fired, to match Chrome. `Shift+Enter` behaves the same (`insertLineBreak`).
- **Detach+reattach focus**: Setting `el.editContext = null` then `el.editContext = new EditContext()` across separate calls does not restore focus. Chrome retains element focus natively, but the polyfill loses it when the hidden textarea is destroyed on detach. Swapping contexts in a single call (`el.editContext = newCtx`) works correctly.

## Testing

- **`tests/unit/`** — pure unit tests for `EditContextState` transitions, runnable without a browser.
- **`tests/api/`** — deterministic tests for each EditContext method and event, run on both `chromium-native` and `chromium-polyfill` by default.
- **`tests/wpt/`** — ports of the [Web Platform Tests](https://github.com/web-platform-tests/wpt/tree/master/editing/edit-context) for EditContext.
- **`tests/fuzz/`** — seeded fuzzers (`pnpm test:fuzz`) that run the same random action sequence on Chrome native and the polyfill, then compare final state and event logs. Includes an IME composition fuzzer (`pnpm test:fuzz:ime`) that uses CDP `Input.imeSetComposition`.

Useful release checks:

```sh
pnpm build
pnpm build:pages
pnpm size
pnpm exec tsc --noEmit
pnpm lint
npm pack --dry-run --cache /tmp/editcontext-polyfill-npm-cache
WEBKIT_COMPAT=1 pnpm exec playwright test --project=webkit-polyfill --workers=1
```

Release documentation:

- **`NEW_POLYFILL_DECOMPOSITION_PLAN.md`** — module boundaries, default vs optional layers, and size budget policy.
- **`CHROMIUM_SOURCE_AUDIT.md`** — Blink source audit outcome, fixes made from the audit, and known native-parity limits.
- **`FUZZING_STRATEGY.md`** — why the existing `tests/fuzz/` suite is kept for release and what the v2 fuzz plan should replace.
- **`TESTPLAN.md`** — release test matrix, Safari 17+ coverage expectations, and performance/size check policy.
