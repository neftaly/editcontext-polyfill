// Performance benchmark: compares Chrome native EditContext vs polyfill.
// Run separately via `pnpm test:perf`. Not part of the regular test suite.

import { test } from "../fixtures/test-base.js";

const HTML = `
  <div id="editor" style="width:600px;height:400px;padding:8px;font:16px monospace;"></div>
`;

const KEYSTROKES = 100;

interface PerfMetrics {
  LayoutCount: number;
  RecalcStyleCount: number;
  TaskDuration: number;
}

async function getCDPMetrics(page: import("@playwright/test").Page): Promise<PerfMetrics> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const { metrics } = await cdp.send("Performance.getMetrics");
  await cdp.detach();
  const get = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0;
  return {
    LayoutCount: get("LayoutCount"),
    RecalcStyleCount: get("RecalcStyleCount"),
    TaskDuration: get("TaskDuration"),
  };
}

function diffMetrics(before: PerfMetrics, after: PerfMetrics): PerfMetrics {
  return {
    LayoutCount: after.LayoutCount - before.LayoutCount,
    RecalcStyleCount: after.RecalcStyleCount - before.RecalcStyleCount,
    TaskDuration: after.TaskDuration - before.TaskDuration,
  };
}

test("benchmark typing performance", async ({ page, setContent }) => {
  await setContent(HTML);

  await page.evaluate(() => {
    const el = document.getElementById("editor")!;
    const ec = new EditContext();
    el.editContext = ec;
    ec.addEventListener("textupdate", ((e: TextUpdateEvent) => {
      ec.updateSelection(e.selectionStart, e.selectionEnd);
    }) as EventListener);
    el.focus();
  });

  const before = await getCDPMetrics(page);
  const wallStart = performance.now();

  await page.keyboard.type("a".repeat(KEYSTROKES), { delay: 0 });

  const wallEnd = performance.now();
  const after = await getCDPMetrics(page);

  const diff = diffMetrics(before, after);
  const wallMs = wallEnd - wallStart;
  const projectName = test.info().project.name;

  console.log(`\n--- ${projectName} ---`);
  console.log(`  Wall time:        ${wallMs.toFixed(1)} ms`);
  console.log(`  Per-keystroke:    ${(wallMs / KEYSTROKES).toFixed(2)} ms`);
  console.log(`  LayoutCount:      ${diff.LayoutCount}`);
  console.log(`  RecalcStyleCount: ${diff.RecalcStyleCount}`);
  console.log(`  TaskDuration:     ${(diff.TaskDuration * 1000).toFixed(1)} ms`);
});
