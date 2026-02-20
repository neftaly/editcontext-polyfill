Functional core (`src/edit-context-state.ts`) / imperative shell (`src/focus-manager.ts`, `src/input-translator.ts`, `src/selection-renderer.ts`). Tests: `unit/` (pure state), `api/` (browser), `wpt/`, `fuzz/` (native vs polyfill).

Commands: `pnpm build`, `pnpm test:local`, `pnpm test:fuzz`, `pnpm test:fuzz:ime`, `pnpm test:perf`, `pnpm lint`, `pnpm lint:fix`.

Always allowed: any `pnpm build`, `pnpm test*`, `pnpm lint*`, `pnpm exec playwright test` commands.
