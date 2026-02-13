// IME composition fuzzer: runs the same random composition sequence on
// chromium-native and chromium-polyfill using CDP Input.imeSetComposition,
// then compares final state, textupdate events, beforeinput events, and
// composition events.
// Requires headed Chrome (Xvfb in Docker) — CDP IME crashes in headless mode.

import { test, expect, chromium, type Page, type CDPSession } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { generateImeSequence } from "./sequence-generator.js";
import {
  DELETE_NATIVE_EDIT_CONTEXT,
  formatSequence,
  setupEditContextWithComposition,
  executeImeActionWithTimeout,
  getState,
  getEventLog,
  getBeforeInputLog,
  getCompositionLog,
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

test.describe("Fuzz IME: native vs polyfill", () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "Chromium only");
    test.skip(
      testInfo.project.name !== "chromium-native",
      "IME fuzzer manages its own native + polyfill contexts",
    );
  });

  for (let i = 0; i < ITERATIONS; i++) {
    const seed = SEED_OFFSET + i;

    test(`seed ${seed}`, async () => {
      const sequence = generateImeSequence(seed, SEQUENCE_LENGTH);

      // Launch headed browser (requires Xvfb in Docker)
      const browser = await chromium.launch({ headless: false });

      try {
        // Native context
        const nativeCtx = await browser.newContext({
          permissions: ["clipboard-read", "clipboard-write"],
        });
        const nativePage = await nativeCtx.newPage();
        const nativeClient = await nativePage.context().newCDPSession(nativePage);
        await navigatePage(nativePage, HTML);
        await setupEditContextWithComposition(nativePage);

        // Polyfill context
        const polyfillCtx = await browser.newContext({
          permissions: ["clipboard-read", "clipboard-write"],
        });
        await polyfillCtx.addInitScript(DELETE_NATIVE_EDIT_CONTEXT);
        await polyfillCtx.addInitScript(polyfillSource);
        const polyfillPage = await polyfillCtx.newPage();
        const polyfillClient = await polyfillPage.context().newCDPSession(polyfillPage);
        await navigatePage(polyfillPage, HTML);
        await setupEditContextWithComposition(polyfillPage);

        // Execute same sequence on both — skip action on both pages if native hangs
        for (const action of sequence) {
          const nativeOk = await executeImeActionWithTimeout(nativePage, nativeClient, action);
          if (!nativeOk) continue;
          await executeImeActionWithTimeout(polyfillPage, polyfillClient, action);
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

        // Compare composition event log
        const nativeComposition = await getCompositionLog(nativePage);
        const polyfillComposition = await getCompositionLog(polyfillPage);
        expect(polyfillComposition, `composition log mismatch (seed ${seed}):\n${seqDump}`).toEqual(
          nativeComposition,
        );

        await nativeCtx.close();
        await polyfillCtx.close();
      } finally {
        await browser.close();
      }
    });
  }
});
