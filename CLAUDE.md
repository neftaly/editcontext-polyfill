# editcontext-polyfill

## Architecture
Functional core / imperative shell. Pure state transitions in `src/edit-context-state.ts`, imperative DOM wiring in `src/focus-manager.ts`, `src/input-translator.ts`, `src/selection-renderer.ts`.

## Commands
- `pnpm build` — ESM + IIFE bundles
- `pnpm test:local` — build + run all Playwright tests
- `pnpm test:perf` — performance benchmark (native vs polyfill)
- `pnpm lint` — Biome check
- `pnpm lint:fix` — Biome auto-fix

## Allowed actions
- Always allowed: run `pnpm build`, `pnpm test:local`, `pnpm test:perf`, `pnpm lint`, `pnpm lint:fix`, and any `pnpm exec playwright test` commands without asking for permission.
