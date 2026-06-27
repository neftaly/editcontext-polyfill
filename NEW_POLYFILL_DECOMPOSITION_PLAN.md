# EditContext Polyfill Architecture Notes

This document records the module-boundary rationale and release policy for the
current implementation. It is intentionally narrower than `TESTPLAN.md`,
`CHROMIUM_SOURCE_AUDIT.md`, and `FUZZING_STRATEGY.md`:

- `TESTPLAN.md` owns release commands, browser matrix, and Safari 17+ coverage.
- `CHROMIUM_SOURCE_AUDIT.md` owns the Blink source audit outcome and known
  native-parity limits.
- `FUZZING_STRATEGY.md` owns the fuzz harness migration decision.

## Goal

Keep the EditContext polyfill modular enough that pure state transitions,
public API shape, DOM association, input capture, focus lifecycle, pointer
selection, and legacy compatibility can be tested and budgeted independently.

Safari 17+ era browsers are the practical non-Chromium release target. The
default install should cover useful EditContext behavior for modern browsers
without native EditContext while keeping heavier compatibility behavior behind
explicit optional entry points or feature flags when possible.

The package must continue to bypass itself when a native EditContext exists
unless the caller explicitly forces the polyfill.

## Why This Structure

The original all-in bundle made installation simple, but it coupled unrelated
concerns:

- Pure EditContext text, selection, and composition transitions.
- WebIDL-like event constructors and public `EditContext` methods.
- DOM association through `HTMLElement.prototype.editContext`.
- Focus redirection and hidden textarea input capture.
- Browser event translation for keyboard, clipboard, beforeinput, and IME paths.
- Pointer selection, visual selection overlays, `execCommand` suppression, and
  framework helpers.

Those pieces have different correctness signals and size tradeoffs. Pure state
can be tested without a browser. Native-vs-polyfill comparison is useful for
public API behavior in Chromium. WebKit and Firefox tests should assert
portable product behavior, not Chrome-specific browser behavior. Optional
editor UX layers should not silently grow the default Safari polyfill.

## Current Shape

| Files | Responsibility | Release stance |
| --- | --- | --- |
| `src/core/`, `src/edit-context-state.ts` | DOM-free state, range, selection, composition, insert/delete transitions | Keep pure and heavily unit-tested. |
| `src/runtime/`, `src/edit-context.ts`, `src/event-types.ts` | Public `EditContext` facade, event effects, bounds storage, browser bookkeeping | Keep separate from DOM attachment and input capture. |
| `src/dom/` | Active-element lookup, event forwarding, caret range, shadow-host helpers | Isolate browser quirks behind small helpers. |
| `src/element-binding.ts`, `src/context-registry.ts` | `HTMLElement.prototype.editContext`, host validation, attached elements | Required default layer. |
| `src/focus-manager.ts`, `src/hidden-textarea.ts` | Active context lifecycle, focus redirection, hidden textarea placement | Required default layer; highest Safari risk. |
| `src/input/`, `src/input-translator.ts` | Input event normalization, typing, delete, clipboard, composition | Required default layer; browser differences need tests. |
| `src/mouse-handler.ts`, `src/selection-renderer.ts` | Pointer selection and visual selection compatibility | Optional-layer candidates when entrypoints are split. |
| `src/exec-command-interceptor.ts` | Legacy command suppression | Optional-layer candidate. |
| `src/create-edit-context.ts` | Framework-neutral setup helper | Convenience helper; should not drive core size. |
| `src/install.ts`, `src/index.ts` | Global installation and IIFE auto-install | Keep thin and stable for release. |

The package root currently preserves the existing public API for release
stability. Future entrypoints can make pointer selection, visual overlays,
`execCommand`, and helpers independently importable, but only with tests and a
size report for each entrypoint.

## Default Versus Optional

Default install should include:

- Native support detection and bypass.
- `EditContext`, `TextUpdateEvent`, `TextFormat`, `TextFormatUpdateEvent`, and
  `CharacterBoundsUpdateEvent` globals when absent.
- `HTMLElement.prototype.editContext`.
- Active lifecycle, hidden textarea, and input translation sufficient for typing,
  deletion, composition, focus, blur, and selection bounds.

Default install should not grow further without an explicit size tradeoff:

- Mouse, drag, double-click, or triple-click selection synthesis.
- CSS caret and selection overlay rendering.
- `execCommand` interception.
- Framework helpers.
- Safari <17 or old Firefox shims.

## Size Policy

`pnpm size` is the release gate for current bundle budgets. It builds the
bundles, measures raw/gzip/brotli output, and checks `scripts/size-budget.json`.

Current enforced budgets:

| Bundle | Raw | Gzip | Brotli |
| --- | ---: | ---: | ---: |
| ESM `dist/index.mjs` | 61,500 B | 13,000 B | 11,300 B |
| IIFE `dist/editcontext-polyfill.iife.js` | 66,500 B | 13,400 B | 11,800 B |
| Combined JS bundles | 128,000 B | 26,200 B | 23,100 B |

Policy:

- Every default-layer feature needs a size report when it changes runtime code.
- Optional features should have independent entrypoints before they become
  materially larger.
- Safari 17+ platform features should be used directly instead of shipping
  compatibility polyfills.
- Runtime dependencies need a size and maintenance review before adoption.
- Source maps are intentionally emitted and shipped for `dist/` bundles and the
  GitHub Pages demo bundle. The source is public, and size budgets measure
  executable JS bundles rather than `.map` files.

## Safari 17+ Boundaries

Safari 17+ lets the default layer assume modern platform features such as
`EventTarget`, `CompositionEvent`, `InputEvent`, `beforeinput`, `KeyboardEvent`,
`DOMRect`, `MutationObserver`, `WeakMap`, private class fields, `Intl.Segmenter`,
`ShadowRoot`, and `HTMLTextAreaElement.setSelectionRange`.

The hidden textarea remains an approximation of native EditContext integration:

- IME candidate positioning cannot be wired into the OS text input service.
- Programmatic selection changes during composition can desync from native IME
  tracking.
- Playwright WebKit is useful regression coverage, but real Safari 17+ macOS and
  iOS smoke tests are still required before release.
- `beforeinput` and `input` behavior varies by input method and keyboard.

## Source Audit Outcome

The current Chromium source audit found no release-blocking mismatch in the
covered public API surface after two fixes:

- Empty `textformatupdate` is dispatched before polyfill-driven `compositionend`.
- `updateCharacterBounds()` stores Blink-style enclosing integer rects with
  NaN-to-zero normalization.

Known limits remain in `CHROMIUM_SOURCE_AUDIT.md`: OS-level IME format spans,
candidate-window integration, `updateControlBounds()`, Blink-only reconversion
paths, `isTrusted`, and Chromium runtime-feature differences around
`updateSelection()` during composition.

## Fuzzing Policy

Keep `tests/fuzz/` for this release. It is still the broad native-vs-polyfill
regression baseline for bundled behavior, shadow DOM, multi-context focus
switching, Chromium CDP IME paths, and cross-browser polyfill consistency.

The v2 fuzz plan should add layered fuzzing for `src/core/`, `src/runtime/`, the
input translator, and smaller integration profiles. The old fuzz suite should
only be retired after the migration and deletion criteria in
`FUZZING_STRATEGY.md` are met.

## Open Decisions

- Whether package root should remain the full convenience export or become a
  slimmer default installer with helpers only on subpaths.
- Whether visual selection rendering is part of the default product promise or
  stays opt-in for editors that need visible DOM selection parity.
- Whether Safari iOS needs a distinct hidden textarea placement strategy from
  Safari macOS.
- Whether `document.activeElement` patching belongs in default or in a
  compatibility profile.
- Whether Firefox is a first-class default target or a separate modern-browser
  compatibility target.
