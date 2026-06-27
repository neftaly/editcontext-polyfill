# Chromium Source Audit

Release-readiness audit for the EditContext polyfill against current Chromium/Blink source.

This is a public-surface audit, not a claim that a hidden-textarea polyfill can
match Blink's browser-process IME integration. The remaining approximation list
below is part of the release contract.

## Source Baseline

Fetched from Chromium Gitiles `refs/heads/main` at commit `ad5dc6067267dcbdce0ebd08f3add6266c7c8dc2` (`main@{#1653698}`, 2026-06-27 20:48:08 UTC).

Primary sources:

- [`edit_context.cc`](https://chromium.googlesource.com/chromium/src/+/ad5dc6067267dcbdce0ebd08f3add6266c7c8dc2/third_party/blink/renderer/core/editing/ime/edit_context.cc)
- [`edit_context.h`](https://chromium.googlesource.com/chromium/src/+/ad5dc6067267dcbdce0ebd08f3add6266c7c8dc2/third_party/blink/renderer/core/editing/ime/edit_context.h)
- [`input_method_controller.cc`](https://chromium.googlesource.com/chromium/src/+/ad5dc6067267dcbdce0ebd08f3add6266c7c8dc2/third_party/blink/renderer/core/editing/ime/input_method_controller.cc)
- [`input_method_controller.h`](https://chromium.googlesource.com/chromium/src/+/ad5dc6067267dcbdce0ebd08f3add6266c7c8dc2/third_party/blink/renderer/core/editing/ime/input_method_controller.h)
- [`edit_context.idl`](https://chromium.googlesource.com/chromium/src/+/ad5dc6067267dcbdce0ebd08f3add6266c7c8dc2/third_party/blink/renderer/core/editing/ime/edit_context.idl)
- [`html_element.idl`](https://chromium.googlesource.com/chromium/src/+/ad5dc6067267dcbdce0ebd08f3add6266c7c8dc2/third_party/blink/renderer/core/html/html_element.idl)
- [`runtime_enabled_features.json5`](https://chromium.googlesource.com/chromium/src/+/ad5dc6067267dcbdce0ebd08f3add6266c7c8dc2/third_party/blink/renderer/platform/runtime_enabled_features.json5)

Supporting context: W3C EditContext draft at https://w3c.github.io/edit-context/.

## Covered Behaviors

Constructor clamping: Blink initializes `text_`, then clamps `selection_start_` and `selection_end_` independently to `text_.length()`. The polyfill matches this, including backward selections where start and end are preserved as independent offsets.

`updateText`: Blink swaps reversed ranges and clamps to text length. Current Chromium main only adjusts selection/composition for `updateText()` behind `EditContextHandleTextOrSelectionUpdateDuringComposition`, which is `status: "test"`. The polyfill matches current stable behavior by changing text only and not firing `textupdate`.

`updateSelection`: Normal clamping and backward selection preservation match Blink. During active composition, the polyfill follows Blink's feature-enabled path and cancels when the selection changes; Chromium main currently gates that cancellation behind the same test-only runtime feature.

Composition: Blink sends `compositionstart` on first non-empty composition text, then `textupdate`, `textformatupdate`, and `characterboundsupdate`. Commit/cancel/finish cleanup sends an empty `textformatupdate` before `compositionend`. The polyfill now follows that cleanup order.

Insert/delete: Blink uses ordered selection for insert and delete ranges, emits `textupdate`, and clamps stale selection offsets before delete operations via stable `UseBoundedSelectionOffsetsInEditContextDeleteOperations`. The polyfill matches the common insert/delete paths and has focused coverage for collapsed, ranged, word, and grapheme deletion.

Focus/blur: Blink `Focus()` finishes the previous active EditContext composition with keep-selection, then marks the new active context; `Blur()` finishes the active composition and clears the active context. The polyfill mirrors this through the hidden textarea focus manager.

Element association: Blink exposes `HTMLElement.editContext`, keeps `attached_elements_`, and currently enforces one associated element. The polyfill mirrors single-element association, `attachedElements()`, detach, and same-context-on-two-elements rejection.

Bounds: Blink stores `updateCharacterBounds()` data as enclosing integer rects after `ClampToWithNaNTo0<float>()`, and `characterBounds()` returns new `DOMRect` objects. The polyfill now normalizes stored character bounds the same way for public reads.

## Fixes Made In This Audit

- Added empty `textformatupdate` dispatch before polyfill-driven `compositionend`, matching Blink cleanup for cancel, commit, finish, blur, and deferred composition end.
- Normalized `updateCharacterBounds()` storage to Blink-style enclosing integer rects with NaN-to-zero float clamping.
- Added focused tests for textformat cleanup order and character bounds normalization.

## Intentional Approximations

- IME `TextFormat` spans are not available from browser events through a polyfill. The polyfill emits a default solid thin underline over the full composition range, then an empty clear event on cleanup.
- `characterboundsupdate` can request bounds from the app, but the polyfill cannot feed per-character bounds back into the OS IME candidate UI. `updateSelectionBounds()` is still used for hidden textarea positioning.
- `updateControlBounds()` is stored/used by Blink for OS layout bounds. The polyfill cannot provide equivalent browser-process integration and treats it as a no-op.
- Blink `SetComposition()` supports IME replacement ranges and `SetCompositionFromExistingText()` for reconversion. The polyfill approximates the web-visible composition pipeline from hidden textarea events and does not expose those Blink-specific replacement-range paths.
- Programmatic `updateSelection()` during active composition follows Blink's feature-enabled behavior, while Chromium main still marks that behavior test-only. Keep this as a known limit until the runtime feature graduates or the project chooses current-stable parity instead.
- Native `isTrusted` and browser-dispatched keyboard/clipboard/composition event trust cannot be reproduced.

## Verification

Commands run:

- `pnpm build` - passed.
- `pnpm exec playwright test tests/api/composition.spec.ts tests/api/bounds.spec.ts --project=chromium-polyfill` - first sandboxed attempt failed before assertions because Chromium could not launch (`sandbox_host_linux.cc:41 Operation not permitted`); rerun with escalation passed, 22/22.
- `pnpm exec playwright test tests/api/bounds.spec.ts --project=chromium-native` - passed, 4/4.

## Release Recommendation

Release with known limits. After the two fixes above, no source-backed release-blocking mismatch was found in the covered public API surface. The remaining differences are inherent to a hidden-textarea polyfill or tied to Chromium runtime features that are still test-only in the audited main-branch source.
