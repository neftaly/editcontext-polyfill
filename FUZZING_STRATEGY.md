# EditContext Fuzzing Strategy

## Recommendation

Keep `tests/fuzz` for the modular release. The current fuzz suite remains the
release regression baseline for broad bundled behavior, while a v2 fuzz harness
can be built in parallel after the release candidate is stable.

The current suite is not the ideal long-term shape for the modular codebase,
but deleting it now would remove the only broad native-vs-polyfill differential
coverage for complex browser input sequences. It also contains helper constants
used by `tests/fixtures/test-base.ts`, so deleting the directory would currently
break non-fuzz tests unless those utilities were moved first.

## Current Value

The existing fuzz tests cover important public-surface behavior after the IIFE
bundle is built:

- `tests/fuzz/fuzz.spec.ts` compares Chromium native EditContext with Chromium
  polyfill for keyboard input, programmatic `updateText`/`updateSelection`,
  focus changes, clipboard-shaped actions, `execCommand`, and DOM stability.
- `tests/fuzz/fuzz-shadow.spec.ts` repeats that comparison through a custom
  element with an existing shadow root, which exercises retargeting and hidden
  textarea placement.
- `tests/fuzz/fuzz-multi.spec.ts` covers multiple EditContext instances and
  focus transfer between attached elements.
- `tests/fuzz/fuzz-ime.spec.ts` compares CDP-driven IME composition behavior
  against native Chromium.
- `tests/fuzz/fuzz-xbrowser.spec.ts` checks polyfill consistency across
  Chromium, Firefox, and WebKit for the subset of actions where browser input
  pipelines are comparable.

The historical notes under `tests/fuzz/` show that this suite has already found
real compatibility bugs in selection clamping, backward selections,
composition lifecycle handling, paste `beforeinput` shape, and hidden-textarea
sync. Those are exactly the kinds of release regressions a layered
implementation is likely to reintroduce.

## Current Problems

The current suite should not become the permanent fuzz architecture:

- It is mostly end-to-end differential testing, so failures can be hard to map
  to the new boundaries in `src/core/`, `src/runtime/`, `src/input/`, and
  DOM/focus modules.
- It reads `dist/editcontext-polyfill.iife.js`, so it requires a build and tests
  bundled behavior rather than individual module contracts.
- Native Chromium and Playwright can hang on some generated input sequences.
  The per-action timeout mitigates this, but skipped actions reduce diagnostic
  clarity.
- The sequence generator uses an approximate tracked text length. That is good
  enough for broad exploration but not precise enough for shrinking and
  explaining failures.
- IME coverage depends on CDP behavior and is Chromium-specific. It remains
  valuable, but it should not be the only way to test composition state.
- Browser-specific concessions in the cross-browser test are embedded directly
  in the harness, making it harder to see which differences are intended
  product behavior and which are harness workarounds.

These problems justify a v2 harness. They do not justify deleting the existing
suite before replacement coverage exists.

## V2 Design

Build v2 as layered fuzzing aligned with the source boundaries:

1. Core transition fuzzing for `src/core/`
   - Generate `updateText`, `updateSelection`, insert, delete, word delete,
     composition set/commit/cancel/suspend, and finish-composition operations.
   - Assert invariants on state shape, effects, selection ordering where
     expected, composition range lifecycle, and Chrome-compatible edge cases
     such as selection positions beyond `text.length`.
   - Keep this DOM-free and fast enough for normal local runs.

2. Runtime/effect fuzzing for `src/runtime/`
   - Feed generated core transitions through `EditContextRuntime`.
   - Assert dispatched `textupdate`, `compositionstart`, `compositionend`,
     `textformatupdate`, and `characterboundsupdate` event shape and order.
   - Include suspended-composition and deferred `compositionend` cases that were
     historically found by IME fuzzing.

3. Input translator browser fuzzing
   - Drive a focused hidden textarea through deterministic Playwright actions.
   - Keep action families explicit: text insertion, delete variants,
     navigation keys, clipboard/drop-shaped input, composition events, focus,
     blur, detach, and programmatic state changes.
   - Record both EditContext events and textarea sync state so failures point to
     input translation instead of only final public state.

4. Integration differential fuzzing
   - Keep a smaller native-vs-polyfill Chromium comparison for bundled release
     safety.
   - Keep separate shadow DOM, multi-context, iframe, and cross-browser
     profiles, but use declared per-browser contracts instead of ad hoc filters.
   - Store failing seeds as structured fixtures and require minimized
     deterministic regression tests for fixes.

5. Reproduction tooling
   - Make every failure print seed, action list, browser/profile, and expected
     contract.
   - Provide a single-seed command for each profile.
   - Add a small reducer or at least action-slicing guidance before expanding
     seed counts.

## Migration Criteria

The v2 suite can supersede the current `tests/fuzz` only after all of these are
true:

- v2 covers the same release-risk profiles: basic editing, shadow DOM,
  multi-context focus transfer, Chromium IME, and cross-browser polyfill
  consistency.
- v2 has deterministic single-seed reproduction commands for each profile.
- Known historical failing seeds or their minimized regressions are represented
  in deterministic `tests/unit/` or `tests/api/` coverage.
- v2 is stable over a meaningful seed window in local Chromium and in the
  container/browser-matrix environment used for release checks.
- The release checklist has run both old and v2 fuzzers at least once and any
  differences have been triaged.
- Shared utilities currently imported from `tests/fuzz/helpers.ts` by
  `tests/fixtures/test-base.ts` have moved to a non-fuzz fixture module.

## Deletion Criteria

Delete the old `tests/fuzz` only when it is no longer the sole owner of any
release-critical coverage:

- `tests/fixtures/test-base.ts` no longer imports from `tests/fuzz/helpers.ts`.
- Every old suite profile has a v2 equivalent or an explicit deterministic
  replacement.
- Current known failures and timeout workarounds are either fixed, reduced to
  regression tests, or documented as intentionally unsupported browser behavior.
- CI/release commands reference the v2 suite, not the old one.
- A final old-vs-v2 comparison run has shown no unique old-suite failures that
  would block the release.

Until those conditions are met, preserving `tests/fuzz` is the safer release
choice.
