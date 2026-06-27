#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const defaultBudgetPath = join(scriptDir, "size-budget.json");

class SizeReportError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const budget = await readBudget(options.budgetPath);
const metafileDir = await mkdtemp(join(tmpdir(), "editcontext-size-"));

try {
  if (options.build) {
    runBuild(metafileDir);
  }

  const bundleDefinitions = await resolveBundleDefinitions(budget, options.includeSourcemaps);
  const bundles = await Promise.all(
    bundleDefinitions.map((bundle) =>
      measureBundle(bundle, join(metafileDir, `${bundle.key}.json`)),
    ),
  );
  const total = totalSizes(bundles);
  const budgetFailures = checkBudgets(bundles, total, budget);

  printReport({ bundles, total, budgetFailures, topModules: budget.analysis?.topModules ?? 10 });

  if (options.keepMetafiles) {
    console.log(`\nMetafiles kept in ${metafileDir}`);
  } else {
    await rm(metafileDir, { recursive: true, force: true });
  }

  if (budgetFailures.length > 0) {
    process.exit(1);
  }
} catch (error) {
  await rm(metafileDir, { recursive: true, force: true });
  if (error instanceof SizeReportError) {
    console.error(error.message);
    process.exit(error.exitCode);
  }
  throw error;
}

function parseArgs(args) {
  const parsed = {
    budgetPath: defaultBudgetPath,
    build: true,
    help: false,
    includeSourcemaps: false,
    keepMetafiles: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--budget") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--budget requires a path");
      }
      parsed.budgetPath = resolve(rootDir, value);
      index += 1;
      continue;
    }

    if (arg === "--no-build") {
      parsed.build = false;
      continue;
    }

    if (arg === "--include-sourcemaps") {
      parsed.includeSourcemaps = true;
      continue;
    }

    if (arg === "--keep-metafiles") {
      parsed.keepMetafiles = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/size-report.mjs [options]

Builds the JS bundles, reports raw/gzip/brotli size, checks scripts/size-budget.json,
and prints esbuild module contribution data when metafiles are available.

Options:
  --budget <path>       Budget JSON path. Default: scripts/size-budget.json
  --no-build            Measure existing dist files without rebuilding.
  --include-sourcemaps  Include sourcemaps when discovering bundles without a budget.
  --keep-metafiles      Keep temporary esbuild metafiles and print their location.
  -h, --help            Show this help.`);
}

async function readBudget(path) {
  const text = await readFile(path, "utf8");
  return JSON.parse(text);
}

function runBuild(metafileDir) {
  console.log("Building bundles with metafile analysis...");

  const result = spawnSync(process.execPath, ["build.mjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      EDITCONTEXT_BUILD_METAFILE_DIR: metafileDir,
    },
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new SizeReportError(
      "Bundle build failed; size report was not generated.",
      result.status ?? 1,
    );
  }
}

async function resolveBundleDefinitions(budget, includeSourcemaps) {
  if (budget.bundles && Object.keys(budget.bundles).length > 0) {
    return Object.entries(budget.bundles).map(([key, bundle]) => ({
      key,
      label: bundle.label ?? key,
      path: bundle.path,
      max: bundle.max ?? {},
    }));
  }

  const distDir = join(rootDir, "dist");
  const files = await readdir(distDir);
  return files
    .filter((file) => includeSourcemaps || !file.endsWith(".map"))
    .filter((file) => /\.(?:cjs|js|mjs)$/.test(file))
    .map((file) => {
      const path = `dist/${file}`;
      return {
        key: file.replace(/\W+/g, "-"),
        label: inferLabel(file),
        path,
        max: {},
      };
    });
}

async function measureBundle(bundle, metafilePath) {
  const absolutePath = join(rootDir, bundle.path);
  const bytes = await readFile(absolutePath);
  const sizes = {
    raw: bytes.byteLength,
    gzip: gzipSync(bytes, { level: 9 }).byteLength,
    brotli: brotliCompressSync(bytes, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      },
    }).byteLength,
  };

  return {
    ...bundle,
    sizes,
    modules: await readModuleContributions(metafilePath, bundle.path),
  };
}

async function readModuleContributions(metafilePath, bundlePath) {
  if (!existsSync(metafilePath)) {
    return [];
  }

  const metafile = JSON.parse(await readFile(metafilePath, "utf8"));
  const output = findMetafileOutput(metafile.outputs ?? {}, bundlePath);
  if (!output?.inputs) {
    return [];
  }

  return Object.entries(output.inputs)
    .map(([path, details]) => ({
      path,
      bytes: details.bytesInOutput ?? 0,
      percent: output.bytes > 0 ? ((details.bytesInOutput ?? 0) / output.bytes) * 100 : 0,
    }))
    .filter((entry) => entry.bytes > 0)
    .sort((left, right) => right.bytes - left.bytes);
}

function findMetafileOutput(outputs, bundlePath) {
  const normalizedBundlePath = toPosixPath(bundlePath);
  return (
    outputs[normalizedBundlePath] ??
    Object.entries(outputs).find(([outputPath]) =>
      toPosixPath(outputPath).endsWith(normalizedBundlePath),
    )?.[1]
  );
}

function totalSizes(bundles) {
  return bundles.reduce(
    (total, bundle) => ({
      raw: total.raw + bundle.sizes.raw,
      gzip: total.gzip + bundle.sizes.gzip,
      brotli: total.brotli + bundle.sizes.brotli,
    }),
    { raw: 0, gzip: 0, brotli: 0 },
  );
}

function checkBudgets(bundles, total, budget) {
  const failures = [];

  for (const bundle of bundles) {
    failures.push(...checkMax(`${bundle.label} (${bundle.path})`, bundle.sizes, bundle.max));
  }

  failures.push(...checkMax("Total", total, budget.total?.max ?? {}));

  return failures;
}

function checkMax(label, sizes, max) {
  return ["raw", "gzip", "brotli"]
    .filter((metric) => Number.isFinite(max[metric]) && sizes[metric] > max[metric])
    .map((metric) => ({
      label,
      metric,
      actual: sizes[metric],
      max: max[metric],
      over: sizes[metric] - max[metric],
    }));
}

function printReport({ bundles, total, budgetFailures, topModules }) {
  console.log("\nBundle sizes (sourcemaps excluded)");
  printRows([
    ["Bundle", "File", "Raw", "Gzip", "Brotli"],
    ...bundles.map((bundle) => [
      bundle.label,
      bundle.path,
      formatBytes(bundle.sizes.raw),
      formatBytes(bundle.sizes.gzip),
      formatBytes(bundle.sizes.brotli),
    ]),
    ["Total", "", formatBytes(total.raw), formatBytes(total.gzip), formatBytes(total.brotli)],
  ]);

  if (budgetFailures.length === 0) {
    console.log("\nBudget: PASS");
  } else {
    console.log("\nBudget: FAIL");
    for (const failure of budgetFailures) {
      console.log(
        `- ${failure.label} ${failure.metric}: ${formatBytes(failure.actual)} exceeds ${formatBytes(
          failure.max,
        )} by ${formatBytes(failure.over)}`,
      );
    }
  }

  printModuleBreakdown(bundles, topModules);
}

function printModuleBreakdown(bundles, topModules) {
  if (topModules <= 0 || bundles.every((bundle) => bundle.modules.length === 0)) {
    return;
  }

  console.log(`\nTop module contributions (${topModules} max per bundle, raw bytes in output)`);

  for (const bundle of bundles) {
    if (bundle.modules.length === 0) {
      continue;
    }

    console.log(`\n${bundle.label} ${bundle.path}`);
    printRows([
      ["Module", "Bytes", "Share"],
      ...bundle.modules
        .slice(0, topModules)
        .map((module) => [module.path, formatBytes(module.bytes), `${module.percent.toFixed(1)}%`]),
    ]);
  }
}

function printRows(rows) {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));

  for (const row of rows) {
    console.log(row.map((cell, index) => cell.padEnd(widths[index])).join("  "));
  }
}

function formatBytes(bytes) {
  return `${bytes.toLocaleString("en-US")} B`;
}

function inferLabel(file) {
  if (file.endsWith(".mjs")) {
    return "ESM";
  }
  if (file.includes(".iife.")) {
    return "IIFE";
  }
  return file;
}

function toPosixPath(path) {
  return path.split(sep).join("/");
}
