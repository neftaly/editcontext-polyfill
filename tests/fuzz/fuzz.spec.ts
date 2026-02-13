// Single fuzzer: runs the same random action sequence on chromium-native and
// chromium-polyfill, then compares final state, textupdate events, and
// beforeinput events.
// IME composition is tested separately in fuzz-ime.spec.ts (requires headed Chrome).

import { test, expect, type Page } from "@playwright/test";
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
  getInnerHTML,
} from "./helpers.js";

const ITERATIONS = Number(process.env.FUZZ_ITERATIONS ?? 30);
const SEED_OFFSET = Number(process.env.FUZZ_SEED_OFFSET ?? 0);
const SEQUENCE_LENGTH = 20;

const polyfillSource = fs.readFileSync(path.resolve("dist/editcontext-polyfill.iife.js"), "utf-8");

const HTML = `<!DOCTYPE html>
<div id="target" style="width:200px;height:100px;"></div>
<div id="other" tabindex="0" style="width:100px;height:50px;"></div>`;

async function navigatePage(page: Page, html: string): Promise<void> {
  await page.route("https://fuzz.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await page.goto("https://fuzz.test/");
}

test.describe("Fuzz: native vs polyfill", () => {
  // Only run on chromium-native — the test creates its own polyfill context.
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "Chromium only");
    test.skip(
      testInfo.project.name !== "chromium-native",
      "Fuzzer manages its own native + polyfill contexts",
    );
  });

  for (let i = 0; i < ITERATIONS; i++) {
    const seed = SEED_OFFSET + i;

    test(`seed ${seed}`, async ({ browser }) => {
      const sequence = generateSequence(seed, SEQUENCE_LENGTH);

      // Native context with clipboard permissions
      const nativeCtx = await browser.newContext({
        permissions: ["clipboard-read", "clipboard-write"],
      });
      const nativePage = await nativeCtx.newPage();
      await navigatePage(nativePage, HTML);
      await setupEditContext(nativePage);

      // Polyfill context with clipboard permissions
      const polyfillCtx = await browser.newContext({
        permissions: ["clipboard-read", "clipboard-write"],
      });
      await polyfillCtx.addInitScript(DELETE_NATIVE_EDIT_CONTEXT);
      await polyfillCtx.addInitScript(polyfillSource);
      const polyfillPage = await polyfillCtx.newPage();
      await navigatePage(polyfillPage, HTML);
      await setupEditContext(polyfillPage);

      // Execute same sequence on both — if native hangs, skip that action on
      // the polyfill page too so both stay in sync.  Timeouts are caused by
      // Chrome/Playwright infrastructure issues, not polyfill bugs.
      for (const action of sequence) {
        const nativeOk = await executeActionWithTimeout(nativePage, action);
        if (!nativeOk) continue; // skip on both pages
        await executeActionWithTimeout(polyfillPage, action);
      }

      const seqDump = formatSequence(sequence);

      // Compare final state
      const nativeState = await getState(nativePage);
      const polyfillState = await getState(polyfillPage);
      expect(polyfillState, `State mismatch (seed ${seed}):\n${seqDump}`).toEqual(nativeState);

      // Compare textupdate event log
      const nativeEvents = await getEventLog(nativePage);
      const polyfillEvents = await getEventLog(polyfillPage);
      expect(polyfillEvents, `Event log mismatch (seed ${seed}):\n${seqDump}`).toEqual(
        nativeEvents,
      );

      // Compare beforeinput event log
      const nativeBeforeInput = await getBeforeInputLog(nativePage);
      const polyfillBeforeInput = await getBeforeInputLog(polyfillPage);
      expect(polyfillBeforeInput, `beforeinput log mismatch (seed ${seed}):\n${seqDump}`).toEqual(
        nativeBeforeInput,
      );

      // Verify execCommand didn't mutate the DOM (innerHTML should match native)
      const nativeHtml = await getInnerHTML(nativePage);
      const polyfillHtml = await getInnerHTML(polyfillPage);
      expect(polyfillHtml, `innerHTML mismatch (seed ${seed}):\n${seqDump}`).toEqual(nativeHtml);

      await nativeCtx.close();
      await polyfillCtx.close();
    });
  }
});
