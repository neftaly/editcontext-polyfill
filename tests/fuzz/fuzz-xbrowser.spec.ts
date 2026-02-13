// Cross-browser fuzzer: runs the same random action sequence on chromium-polyfill
// and compares against firefox-polyfill and webkit-polyfill. All three should
// produce identical EditContext state, textupdate events, and beforeinput events.
//
// Only runs with ALL_BROWSERS=1 (Docker or CI).
// Skips IME, paste, and execCommand actions (browser-specific clipboard/command behavior).

import { test, expect, chromium, firefox, webkit, type Page, type Browser } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { generateSequence } from "./sequence-generator.js";
import {
  DELETE_NATIVE_EDIT_CONTEXT,
  formatSequence,
  setupEditContext,
  executeActionWithTimeout,
  getState,
  getEventLog,
  getBeforeInputLog,
  type FuzzAction,
} from "./helpers.js";

const ITERATIONS = Number(process.env.FUZZ_XBROWSER_ITERATIONS ?? 20);
const SEED_OFFSET = Number(process.env.FUZZ_SEED_OFFSET ?? 0);
const SEQUENCE_LENGTH = 15;

const polyfillSource = fs.readFileSync(path.resolve("dist/editcontext-polyfill.iife.js"), "utf-8");

const HTML = `<!DOCTYPE html>
<div id="target" style="width:200px;height:100px;"></div>
<div id="other" tabindex="0" style="width:100px;height:50px;"></div>`;

/** Filter out actions that rely on browser-specific behavior.
 *  - paste/execCommand: clipboard access differs across browsers
 *  - pressCombo: Ctrl+Backspace/Delete word deletion doesn't fire beforeinput in WebKit */
function filterActions(actions: FuzzAction[]): FuzzAction[] {
  return actions.filter(
    (a) => a.type !== "paste" && a.type !== "execCommand" && a.type !== "pressCombo",
  );
}

async function launchPolyfillPage(
  browserType: typeof chromium,
): Promise<{ browser: Browser; page: Page }> {
  const browser = await browserType.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript(DELETE_NATIVE_EDIT_CONTEXT);
  await ctx.addInitScript(polyfillSource);
  const page = await ctx.newPage();
  await page.route("https://fuzz.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: HTML }),
  );
  await page.goto("https://fuzz.test/");
  await setupEditContext(page);
  return { browser, page };
}

test.describe("Fuzz: cross-browser polyfill", () => {
  // Only run on chromium-native to avoid duplicate runs across projects.
  // Only run when ALL_BROWSERS is set (Docker/CI).
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "Cross-browser fuzzer runs from Chromium project");
    test.skip(testInfo.project.name !== "chromium-native", "Runs once from chromium-native");
    test.skip(!process.env.ALL_BROWSERS, "Requires ALL_BROWSERS=1");
  });

  for (let i = 0; i < ITERATIONS; i++) {
    const seed = SEED_OFFSET + i;

    test(`seed ${seed}`, async () => {
      const sequence = filterActions(generateSequence(seed, SEQUENCE_LENGTH));

      // Launch all three browsers with polyfill
      const chromeResult = await launchPolyfillPage(chromium);
      const firefoxResult = await launchPolyfillPage(firefox);

      let webkitResult: { browser: Browser; page: Page } | null = null;
      try {
        webkitResult = await launchPolyfillPage(webkit);
      } catch {
        // WebKit may not be available in all environments
      }

      try {
        // Execute same sequence on all browsers
        for (const action of sequence) {
          const chromeOk = await executeActionWithTimeout(chromeResult.page, action);
          if (!chromeOk) continue;
          await executeActionWithTimeout(firefoxResult.page, action);
          if (webkitResult) await executeActionWithTimeout(webkitResult.page, action);
        }

        const seqDump = formatSequence(sequence);

        // Get Chrome polyfill state as reference
        const chromeState = await getState(chromeResult.page);
        const chromeEvents = await getEventLog(chromeResult.page);
        const chromeBeforeInput = await getBeforeInputLog(chromeResult.page);

        // Compare Firefox polyfill
        const firefoxState = await getState(firefoxResult.page);
        const firefoxEvents = await getEventLog(firefoxResult.page);
        const firefoxBeforeInput = await getBeforeInputLog(firefoxResult.page);

        expect(firefoxState, `Firefox state mismatch (seed ${seed}):\n${seqDump}`).toEqual(
          chromeState,
        );
        expect(firefoxEvents, `Firefox event log mismatch (seed ${seed}):\n${seqDump}`).toEqual(
          chromeEvents,
        );
        expect(
          firefoxBeforeInput,
          `Firefox beforeinput log mismatch (seed ${seed}):\n${seqDump}`,
        ).toEqual(chromeBeforeInput);

        // Compare WebKit polyfill — text content must match. Selection and
        // beforeinput are not compared: WebKit's textarea doesn't fire
        // beforeinput for no-op deletes (at text boundaries), which skips
        // the selection clamping that Chrome performs. This causes selection to
        // drift even though the text content is identical.
        if (webkitResult) {
          const webkitState = await getState(webkitResult.page);
          const webkitEvents = await getEventLog(webkitResult.page);

          expect(webkitState?.text, `WebKit text mismatch (seed ${seed}):\n${seqDump}`).toEqual(
            chromeState?.text,
          );
          // Compare textupdate event text only (selection fields may drift)
          const chromeTexts = chromeEvents.map((e) => e.text);
          const webkitTexts = webkitEvents.map((e) => e.text);
          expect(
            webkitTexts,
            `WebKit textupdate texts mismatch (seed ${seed}):\n${seqDump}`,
          ).toEqual(chromeTexts);
        }
      } finally {
        await chromeResult.browser.close();
        await firefoxResult.browser.close();
        if (webkitResult) await webkitResult.browser.close();
      }
    });
  }
});
