import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as esbuild from "esbuild";

const metafileDir = process.env.EDITCONTEXT_BUILD_METAFILE_DIR;

async function buildBundle(name, options) {
  const result = await esbuild.build({
    ...options,
    metafile: Boolean(metafileDir),
  });

  if (metafileDir && result.metafile) {
    await mkdir(metafileDir, { recursive: true });
    await writeFile(
      join(metafileDir, `${name}.json`),
      `${JSON.stringify(result.metafile, null, 2)}\n`,
    );
  }
}

await Promise.all([
  buildBundle("esm", {
    entryPoints: ["src/index.ts"],
    bundle: true,
    format: "esm",
    outfile: "dist/index.mjs",
    target: "es2022",
    sourcemap: true,
    platform: "neutral",
    define: { "process.env.NODE_ENV": '"production"' },
  }),
  buildBundle("iife", {
    entryPoints: ["src/index.ts"],
    bundle: true,
    format: "iife",
    globalName: "EditContextPolyfill",
    outfile: "dist/editcontext-polyfill.iife.js",
    target: "es2022",
    sourcemap: true,
    define: { "process.env.NODE_ENV": '"development"' },
    // Ensure the IIFE global is on globalThis even when the script runs
    // in a scoped context (e.g. Playwright addInitScript, CSP eval).
    footer: { js: "try{globalThis.EditContextPolyfill=EditContextPolyfill}catch(e){}" },
  }),
]);
