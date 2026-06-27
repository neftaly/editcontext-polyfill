# Test Plan for the EditContext Polyfill Release

This release test plan covers the modular implementation that separates
EditContext state, DOM attachment, input capture, composition handling, selection
rendering, and browser-specific shims. Chrome native remains the reference where
it is useful, but the polyfill must also work in Safari 17+ era browsers where
native EditContext is absent.

Related release docs:

- `NEW_POLYFILL_DECOMPOSITION_PLAN.md` explains module boundaries, default vs
  optional layers, and size policy.
- `CHROMIUM_SOURCE_AUDIT.md` records the current Blink source audit, fixes made
  from it, and known native-parity limits.
- `FUZZING_STRATEGY.md` owns the fuzz harness migration criteria.

## Principles

- Test stable contracts at the lowest layer that can observe them. State
  transitions belong in unit tests; browser input pipelines belong in Playwright.
- Compare Chrome native and Chromium polyfill for spec-level behavior, not for
  browser-specific quirks.
- Treat WebKit as a first-class compatibility target. It is not a native reference;
  it is where the polyfill's hidden editing surface, focus handling, beforeinput
  differences, and composition paths need practical coverage.
- Keep routine local runs fast. Expensive browser-matrix and fuzz runs are
  opt-in locally and enabled in container/CI-style runs with `ALL_BROWSERS=1`.
- Benchmarking is observational by default. Normal CI should fail on correctness
  and explicit size budgets, not on noisy latency thresholds.

## Playwright Projects

Default local projects:

- `chromium-native`: Chrome's native EditContext. Use as the reference for
  deterministic API behavior, event shape, event order, and CDP IME scenarios.
- `chromium-polyfill`: Chrome with native EditContext globals removed before the
  IIFE loads. Use for native-vs-polyfill comparison in the same browser.

Opt-in compatibility projects:

- `chromium-polyfill-frozen-focus`: Chrome polyfill with inherited `focus` and
  `blur` accessors made non-writable. This is a lightweight proxy for descriptor
  assumptions that have broken in non-Chrome browsers.
- `firefox-polyfill`: Firefox polyfill. Use as a portability canary for focus,
  keyboard workflow, beforeinput, and descriptor behavior.
- `webkit-polyfill`: Playwright WebKit using the Desktop Safari device profile.
  Use as the practical Safari 17+ automated target.

Environment flags:

```bash
# Fast local default: Chrome native and Chrome polyfill
pnpm exec playwright test

# Add one compatibility target
FIREFOX_COMPAT=1 pnpm exec playwright test --project=firefox-polyfill
WEBKIT_COMPAT=1 pnpm exec playwright test --project=webkit-polyfill
FROZEN_FOCUS_COMPAT=1 pnpm exec playwright test --project=chromium-polyfill-frozen-focus

# Full compatibility matrix
ALL_BROWSERS=1 pnpm exec playwright test
```

The Docker test image sets `ALL_BROWSERS=1`, so container runs continue to
exercise Firefox and WebKit when the installed browser dependencies support it.

## Spec Conformance

Spec conformance is split between unit tests and browser API tests.

Unit tests under `tests/unit/` should cover pure state and range behavior:

- constructor defaults and clamping
- `updateText` replacement, insertion, deletion, range swapping, and clamping
- `updateSelection` ordering and clamping
- composition range bookkeeping and cancellation rules that do not need a real
  browser input pipeline
- grapheme-aware deletion helpers if the implementation exposes them as separate
  modules

Browser API tests under `tests/api/` should cover behavior that requires DOM,
focus, keyboard, browser events, or native comparison:

- element binding and `attachedElements()`
- activation and deactivation on focus, blur, detach, and focus transfer
- keyboard insertion and deletion through the browser input pipeline
- `beforeinput`, `textupdate`, `compositionstart`, and `compositionend` event
  shape and ordering
- bounds APIs, including stored `DOMRect` values and character-bounds ranges
- iframe behavior that depends on same-origin globals and per-realm injection

Run deterministic API tests on `chromium-native` and `chromium-polyfill` when
the expected behavior is spec-level and Chrome native is stable enough to be a
reference. For polyfill-only integration behavior, skip the native project with an
explicit reason. For known browser pipeline differences, assert the portable
contract instead of forcing Chrome-native parity.

Existing WPT ports under `tests/wpt/` remain the external conformance baseline.
When a WPT assertion conflicts with current native Chrome behavior, document the
choice in the test and prefer a narrow expected-difference test over broad
skips.

## Browser Compatibility

Compatibility tests prove that the modular layers compose correctly in
browsers without native EditContext.

Chromium polyfill remains the cleanest same-browser comparison target. It should
catch polyfill regressions without WebKit or Firefox browser-specific differences.

Firefox polyfill should focus on:

- inherited or non-writable DOM method descriptors
- focus and blur ordering
- keyboard workflow coverage such as Enter, Tab, arrow movement, and selection
- beforeinput availability and inputType normalization
- shadow DOM attachment if a regression has appeared there

WebKit polyfill should focus on Safari 17+ practical behavior:

- hidden editing surface focus stability
- no-op deletes and boundary selection behavior
- beforeinput differences, especially when WebKit omits events Chrome fires
- text selection synchronization after mouse, keyboard, and programmatic changes
- composition lifecycle coverage to the extent Playwright WebKit can drive it
- bounds and DOMRect handling in real layout
- shadow DOM and iframe smoke coverage when the polyfill supports those scopes

Automated WebKit is not a replacement for real Safari manual smoke testing for
OS IME candidate windows, autocorrect, spellcheck UI, and platform keyboard
shortcuts. Keep those as release-check items rather than Playwright assertions.

## Safari 17+ Risk Coverage

The highest-risk Safari-era areas deserve explicit deterministic coverage:

- The polyfill must install when `window.EditContext`, `TextUpdateEvent`,
  `TextFormatUpdateEvent`, `CharacterBoundsUpdateEvent`, and `TextFormat` are
  absent.
- The hidden textarea or editing proxy must not leak user-visible DOM, steal
  focus permanently, or cause repeated layout churn per keystroke.
- Selection state must remain coherent when WebKit suppresses no-op
  `beforeinput` events at text boundaries.
- Composition cancellation must be deterministic on blur, detach, and
  programmatic text or selection changes.
- Mouse and keyboard selection paths must converge on the same EditContext
  state.
- Bounds updates must tolerate WebKit DOMRect objects and fractional layout
  values.
- Feature detection must distinguish native support from partial or deleted
  globals without assuming Chrome-only prototypes.

Each Safari-risk regression should become either a WebKit project test, a
`chromium-polyfill-frozen-focus` proxy test, or a unit test against the relevant
module.

## Fuzzing

Fuzzers are a safety net after deterministic tests, not the primary definition
of correctness.

Keep the current `tests/fuzz/` suite for this release. It remains the broad
native-vs-polyfill regression baseline while the v2 layered fuzz harness is
designed; deletion criteria live in `FUZZING_STRATEGY.md`.

Recommended layers:

- `tests/fuzz/fuzz.spec.ts`: seeded Chromium native-vs-polyfill comparison for
  keyboard, programmatic API calls, focus changes, clipboard-shaped actions, and
  selection movement.
- `tests/fuzz/fuzz-ime.spec.ts`: Chromium-only IME comparison using CDP
  `Input.imeSetComposition` and `Input.insertText`.
- `tests/fuzz/fuzz-shadow.spec.ts`: shadow DOM coverage when the attachment
  layer supports it.
- `tests/fuzz/fuzz-multi.spec.ts`: multiple EditContext instances and focus
  switching.
- `tests/fuzz/fuzz-xbrowser.spec.ts`: polyfill-only cross-browser comparison for
  action subsets that are not dominated by browser-specific clipboard,
  `execCommand`, or no-op beforeinput behavior.

Fuzzer configuration should remain seedable:

```bash
FUZZ_ITERATIONS=100 FUZZ_SEED_OFFSET=500 pnpm test:fuzz
FUZZ_IME_HOURS=1 tests/fuzz/run-ime-fuzz.sh
ALL_BROWSERS=1 FUZZ_XBROWSER_ITERATIONS=50 pnpm exec playwright test tests/fuzz/fuzz-xbrowser.spec.ts
```

When fuzzing finds a bug, reduce it to the smallest deterministic regression
test before treating it as fixed. Keep the seed in the regression test name or
comment only when it helps explain the original failure.

## Regression Tests

Regression tests should live closest to the failed contract:

- Pure state bugs go in `tests/unit/`.
- Browser event, focus, selection, composition, mouse, iframe, or bounds bugs go
  in `tests/api/`.
- Safari/WebKit-specific failures run under `webkit-polyfill` when they need
  WebKit, or under `chromium-polyfill-frozen-focus` when descriptor simulation is
  enough.
- Fuzz-only failures should be minimized into deterministic tests, with the
  fuzzer seed retained as reproduction metadata.

Every regression test should assert the externally observable behavior, not a
private implementation detail from source modules, unless the bug is
specifically in a pure helper module.

## Benchmarking

Benchmarks live under `tests/perf/` and run separately from normal correctness
tests:

```bash
pnpm test:perf
```

Measure three dimensions:

- Latency: wall-clock time per keystroke or operation, browser task duration,
  script duration, and the in-page gap from `beforeinput` to `textupdate` where
  that event pair exists.
- DOM/layout churn: `LayoutCount`, `RecalcStyleCount`, layout/style durations,
  mutation counts during typing, live node count, and hidden editing-surface
  count after setup.
- Size context: raw, gzip, and brotli bundle size from the built IIFE, plus the
  authoritative size-script result owned outside this plan.

Interpret performance with size in the loop. A smaller modular build that
is marginally slower may be acceptable; a faster path that adds persistent DOM
churn or materially grows the compressed bundle needs explicit justification.
Use Chrome native as a latency reference, Chromium polyfill as the stable
same-browser comparison, and WebKit only for compatibility profiling because
its input pipeline differs.

Normal CI should fail benchmarks only for correctness sanity checks, for
example wrong final text, missing expected `textupdate` events, or a benchmark
harness error. Do not fail normal CI on per-keystroke timing, CDP task duration,
layout count, or heap deltas.

A dedicated benchmark job may fail on performance only when all of the following
are true:

- it runs on pinned hardware or a stable runner class
- it compares medians across repeated runs against a committed or dashboarded
  baseline
- the regression is large enough to exceed normal noise, for example 25-30% on
  latency or a repeatable new layout/recalc per keystroke
- the size script separately enforces any raw/gzip/brotli budget

Benchmark output should be easy to paste into release notes or PRs. Prefer
structured console summaries over hidden artifacts unless a future dashboard is
added.

## Release Checks

Before a release candidate:

```bash
pnpm lint
pnpm build
pnpm build:pages
pnpm size
pnpm exec tsc --noEmit
pnpm test:local
pnpm test:perf
ALL_BROWSERS=1 pnpm exec playwright test
npm pack --dry-run --cache /tmp/editcontext-polyfill-npm-cache
```

Then run manual Safari checks on a real Safari 17+ browser for IME candidate UI,
autocorrect/spellcheck, platform shortcuts, and any demo pages that exercise
selection rendering or bounds updates.
