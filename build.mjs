import * as esbuild from "esbuild";

await Promise.all([
  esbuild.build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    format: "esm",
    outfile: "dist/index.mjs",
    target: "es2022",
    sourcemap: true,
    platform: "neutral",
    define: { "process.env.NODE_ENV": '"production"' },
  }),
  esbuild.build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    format: "iife",
    globalName: "EditContextPolyfill",
    outfile: "dist/editcontext-polyfill.iife.js",
    target: "es2022",
    sourcemap: true,
    define: { "process.env.NODE_ENV": '"development"' },
  }),
]);
