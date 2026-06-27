// Performance benchmark: compares Chrome native EditContext vs polyfill.
// Run separately via `pnpm test:perf`. Not part of the regular test suite.
// This file has sanity assertions only; timing and layout numbers are reports.

import type { CDPSession, Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { test, expect } from "../fixtures/test-base.js";

const HTML = `
  <div id="editor" style="width:600px;height:400px;padding:8px;font:16px monospace;"></div>
`;

const KEYSTROKES = 200;
const PROGRAMMATIC_UPDATES = 2000;
const DIST_BUNDLE = path.resolve("dist/editcontext-polyfill.iife.js");

const CDP_METRIC_NAMES = [
  "LayoutCount",
  "RecalcStyleCount",
  "LayoutDuration",
  "RecalcStyleDuration",
  "ScriptDuration",
  "TaskDuration",
  "JSHeapUsedSize",
] as const;

type CDPMetricName = (typeof CDP_METRIC_NAMES)[number];
type PerfMetrics = Record<CDPMetricName, number>;

interface BrowserBenchState {
  beforeInputs: number;
  hiddenTextareas: number;
  mutationCount: number;
  mutationRecords: number;
  nodeCount: number;
  selectionEnd: number;
  selectionStart: number;
  textLength: number;
  textUpdateGapsMs: number[];
  textUpdates: number;
}

interface MetricSummary {
  count: number;
  max: number;
  mean: number;
  p95: number;
}

interface BundleSizeContext {
  brotliBytes: number;
  gzipBytes: number;
  rawBytes: number;
}

let printedBundleSize = false;

function emptyMetrics(): PerfMetrics {
  return Object.fromEntries(CDP_METRIC_NAMES.map((name) => [name, 0])) as PerfMetrics;
}

async function readCDPMetrics(cdp: CDPSession): Promise<PerfMetrics> {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const result = emptyMetrics();
  for (const name of CDP_METRIC_NAMES) {
    result[name] = metrics.find((metric: { name: string }) => metric.name === name)?.value ?? 0;
  }
  return result;
}

async function openCDPMetrics(page: Page): Promise<{
  detach: () => Promise<void>;
  read: () => Promise<PerfMetrics>;
}> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  return {
    detach: () => cdp.detach(),
    read: () => readCDPMetrics(cdp),
  };
}

function diffMetrics(before: PerfMetrics, after: PerfMetrics): PerfMetrics {
  const diff = emptyMetrics();
  for (const name of CDP_METRIC_NAMES) {
    diff[name] = after[name] - before[name];
  }
  return diff;
}

function summarize(values: number[]): MetricSummary {
  if (values.length === 0) {
    return { count: 0, max: 0, mean: 0, p95: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return {
    count: sorted.length,
    max: sorted[sorted.length - 1],
    mean: total / sorted.length,
    p95: sorted[p95Index],
  };
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function formatMs(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}

function readBundleSizeContext(): BundleSizeContext | null {
  if (!fs.existsSync(DIST_BUNDLE)) {
    return null;
  }

  const bundle = fs.readFileSync(DIST_BUNDLE);
  return {
    brotliBytes: brotliCompressSync(bundle).byteLength,
    gzipBytes: gzipSync(bundle).byteLength,
    rawBytes: bundle.byteLength,
  };
}

function logBundleSizeContext(projectName: string): void {
  if (printedBundleSize || !projectName.includes("polyfill")) {
    return;
  }

  const size = readBundleSizeContext();
  if (!size) {
    return;
  }

  printedBundleSize = true;
  console.log("\n--- bundle size context ---");
  console.log(`  Raw:    ${formatBytes(size.rawBytes)}`);
  console.log(`  Gzip:   ${formatBytes(size.gzipBytes)}`);
  console.log(`  Brotli: ${formatBytes(size.brotliBytes)}`);
}

async function waitForAnimationFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

async function installTypingBenchmark(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.getElementById("editor")!;
    const ec = new EditContext();
    el.editContext = ec;

    const bench = {
      beforeInputAt: 0,
      beforeInputs: 0,
      mutationCount: 0,
      mutationRecords: 0,
      textUpdateGapsMs: [] as number[],
      textUpdates: 0,
    };

    const observer = new MutationObserver((records) => {
      bench.mutationRecords += records.length;
      for (const record of records) {
        bench.mutationCount += record.addedNodes.length + record.removedNodes.length;
        if (record.type === "attributes" || record.type === "characterData") {
          bench.mutationCount += 1;
        }
      }
    });

    observer.observe(document.body, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });

    el.addEventListener("beforeinput", () => {
      bench.beforeInputAt = performance.now();
      bench.beforeInputs += 1;
    });

    ec.addEventListener("textupdate", (() => {
      bench.textUpdates += 1;
      if (bench.beforeInputAt > 0) {
        bench.textUpdateGapsMs.push(performance.now() - bench.beforeInputAt);
      }
    }) as EventListener);

    el.focus();
    (window as any).__bench = bench;
    (window as any).__ec = ec;
  });
}

async function readBrowserBenchState(page: Page): Promise<BrowserBenchState> {
  return page.evaluate(() => {
    const bench = (window as any).__bench;
    const ec = (window as any).__ec as EditContext;
    return {
      beforeInputs: bench.beforeInputs,
      hiddenTextareas: document.querySelectorAll("textarea").length,
      mutationCount: bench.mutationCount,
      mutationRecords: bench.mutationRecords,
      nodeCount: document.getElementsByTagName("*").length,
      selectionEnd: ec.selectionEnd,
      selectionStart: ec.selectionStart,
      textLength: ec.text.length,
      textUpdateGapsMs: bench.textUpdateGapsMs,
      textUpdates: bench.textUpdates,
    };
  });
}

async function resetBrowserBenchState(page: Page): Promise<void> {
  await page.evaluate(() => {
    const bench = (window as any).__bench;
    bench.beforeInputAt = 0;
    bench.beforeInputs = 0;
    bench.mutationCount = 0;
    bench.mutationRecords = 0;
    bench.textUpdateGapsMs = [];
    bench.textUpdates = 0;
  });
}

function logCDPMetrics(diff: PerfMetrics): void {
  console.log(`  TaskDuration:        ${formatMs(diff.TaskDuration * 1000)}`);
  console.log(`  ScriptDuration:      ${formatMs(diff.ScriptDuration * 1000)}`);
  console.log(`  LayoutCount:         ${diff.LayoutCount}`);
  console.log(`  LayoutDuration:      ${formatMs(diff.LayoutDuration * 1000)}`);
  console.log(`  RecalcStyleCount:    ${diff.RecalcStyleCount}`);
  console.log(`  RecalcStyleDuration: ${formatMs(diff.RecalcStyleDuration * 1000)}`);
  console.log(`  JSHeapUsedSize diff: ${formatBytes(diff.JSHeapUsedSize)}`);
}

test.describe("EditContext performance benchmarks", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== "chromium", "CDP Performance metrics are Chromium-only");
  });

  test("typing pipeline latency and DOM churn", async ({ page, setContent }, testInfo) => {
    await setContent(HTML);
    await installTypingBenchmark(page);
    await waitForAnimationFrame(page);
    await resetBrowserBenchState(page);

    const cdpMetrics = await openCDPMetrics(page);
    try {
      const before = await cdpMetrics.read();
      const wallStart = performance.now();

      await page.keyboard.type("a".repeat(KEYSTROKES), { delay: 0 });
      await waitForAnimationFrame(page);

      const wallMs = performance.now() - wallStart;
      const after = await cdpMetrics.read();
      const diff = diffMetrics(before, after);
      const state = await readBrowserBenchState(page);
      const textUpdateGap = summarize(state.textUpdateGapsMs);
      const projectName = testInfo.project.name;

      expect(state.textLength).toBe(KEYSTROKES);
      expect(state.selectionStart).toBe(KEYSTROKES);
      expect(state.selectionEnd).toBe(KEYSTROKES);
      expect(state.textUpdates).toBe(KEYSTROKES);

      logBundleSizeContext(projectName);
      console.log(`\n--- ${projectName}: typing pipeline ---`);
      console.log(`  Keystrokes:          ${KEYSTROKES}`);
      console.log(`  Wall time:           ${formatMs(wallMs)}`);
      console.log(`  Wall per keystroke:  ${formatMs(wallMs / KEYSTROKES)}`);
      console.log(
        `  beforeinput events:  ${state.beforeInputs}; textupdate events: ${state.textUpdates}`,
      );
      console.log(
        `  beforeinput->textupdate: count=${textUpdateGap.count}, mean=${formatMs(
          textUpdateGap.mean,
        )}, p95=${formatMs(textUpdateGap.p95)}, max=${formatMs(textUpdateGap.max)}`,
      );
      console.log(
        `  DOM churn: mutations=${state.mutationCount}, records=${state.mutationRecords}, nodes=${state.nodeCount}, textareas=${state.hiddenTextareas}`,
      );
      logCDPMetrics(diff);
    } finally {
      await cdpMetrics.detach();
    }
  });

  test("programmatic updateText/updateSelection throughput", async ({
    page,
    setContent,
  }, testInfo) => {
    await setContent(HTML);

    const result = await page.evaluate((updates) => {
      const ec = new EditContext();
      const start = performance.now();

      for (let i = 0; i < updates; i += 1) {
        const offset = ec.text.length;
        ec.updateText(offset, offset, "a");
        ec.updateSelection(offset + 1, offset + 1);
      }

      const durationMs = performance.now() - start;
      return {
        durationMs,
        selectionStart: ec.selectionStart,
        textLength: ec.text.length,
      };
    }, PROGRAMMATIC_UPDATES);

    expect(result.textLength).toBe(PROGRAMMATIC_UPDATES);
    expect(result.selectionStart).toBe(PROGRAMMATIC_UPDATES);

    console.log(`\n--- ${testInfo.project.name}: state operations ---`);
    console.log(`  Operations:       ${PROGRAMMATIC_UPDATES}`);
    console.log(`  Wall time:        ${formatMs(result.durationMs)}`);
    console.log(`  Per operation:    ${formatMs(result.durationMs / PROGRAMMATIC_UPDATES)}`);
  });
});
