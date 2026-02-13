import * as esbuild from "esbuild";

// Build the IIFE polyfill into example/ so the dev server can serve it
const ctx = await esbuild.context({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "iife",
  globalName: "EditContextPolyfill",
  outfile: "example/editcontext-polyfill.iife.js",
  target: "es2022",
  sourcemap: true,
  define: { "process.env.NODE_ENV": '"development"' },
});

await ctx.watch();
await ctx.serve({ servedir: "example", port: 3000 });

console.log("Dev server running at http://localhost:3000");
