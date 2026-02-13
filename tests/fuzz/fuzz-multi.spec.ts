// Multi-EditContext fuzzer: two target elements with separate EditContexts.
// Tests activate/deactivate cleanup when switching between them.

import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { generateMultiSequence } from "./sequence-generator.js";
import {
  DELETE_NATIVE_EDIT_CONTEXT,
  formatSequence,
  executeAction,
  type FuzzAction,
  type EditContextState,
  type TextUpdateEntry,
} from "./helpers.js";

const ITERATIONS = Number(process.env.FUZZ_ITERATIONS ?? 30);
const SEED_OFFSET = Number(process.env.FUZZ_SEED_OFFSET ?? 0);
const SEQUENCE_LENGTH = 20;

const polyfillSource = fs.readFileSync(path.resolve("dist/editcontext-polyfill.iife.js"), "utf-8");

const HTML = `<!DOCTYPE html>
<div id="target" style="width:200px;height:100px;"></div>
<div id="target2" style="width:200px;height:100px;"></div>
<div id="other" tabindex="0" style="width:100px;height:50px;"></div>`;

async function navigatePage(page: Page, html: string): Promise<void> {
  await page.route("https://fuzz-multi.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await page.goto("https://fuzz-multi.test/");
}

interface MultiState {
  state1: EditContextState;
  state2: EditContextState;
  events1: TextUpdateEntry[];
  events2: TextUpdateEntry[];
}

/**
 * Set up two EditContexts on #target and #target2. The "active" one (for
 * executeAction's __ec/__el globals) starts as target1.
 */
async function setupMultiEditContext(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el1 = document.getElementById("target")!;
    const ec1 = new EditContext();
    el1.editContext = ec1;

    const el2 = document.getElementById("target2")!;
    const ec2 = new EditContext();
    el2.editContext = ec2;

    // Per-target event logs
    (window as any).__events1 = [] as any[];
    (window as any).__events2 = [] as any[];
    (window as any).__ec1 = ec1;
    (window as any).__ec2 = ec2;
    (window as any).__el1 = el1;
    (window as any).__el2 = el2;

    ec1.addEventListener("textupdate", ((e: TextUpdateEvent) => {
      (window as any).__events1.push({
        text: e.text,
        updateRangeStart: e.updateRangeStart,
        updateRangeEnd: e.updateRangeEnd,
        selectionStart: e.selectionStart,
        selectionEnd: e.selectionEnd,
      });
    }) as EventListener);

    ec2.addEventListener("textupdate", ((e: TextUpdateEvent) => {
      (window as any).__events2.push({
        text: e.text,
        updateRangeStart: e.updateRangeStart,
        updateRangeEnd: e.updateRangeEnd,
        selectionStart: e.selectionStart,
        selectionEnd: e.selectionEnd,
      });
    }) as EventListener);

    // Start with target1 as the active target
    (window as any).__ec = ec1;
    (window as any).__el = el1;
    (window as any).__events = (window as any).__events1;
    (window as any).__beforeInputEvents = [];
    el1.focus();
  });
}

/** Wire up focusTarget1/focusTarget2 to swap the __ec/__el globals. */
async function executeMultiAction(page: Page, action: FuzzAction): Promise<void> {
  if (action.type === "focusTarget1") {
    await page.evaluate(() => {
      const el = (window as any).__el1 as HTMLElement;
      (window as any).__ec = (window as any).__ec1;
      (window as any).__el = el;
      (window as any).__events = (window as any).__events1;
      el.focus();
    });
  } else if (action.type === "focusTarget2") {
    await page.evaluate(() => {
      const el = (window as any).__el2 as HTMLElement;
      (window as any).__ec = (window as any).__ec2;
      (window as any).__el = el;
      (window as any).__events = (window as any).__events2;
      el.focus();
    });
  } else {
    await executeAction(page, action as any);
  }
}

const ACTION_TIMEOUT = 5000;

async function executeMultiActionWithTimeout(
  page: Page,
  action: FuzzAction,
  timeoutMs: number = ACTION_TIMEOUT,
): Promise<boolean> {
  try {
    await Promise.race([
      executeMultiAction(page, action),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Action timed out")), timeoutMs),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function getMultiState(page: Page): Promise<MultiState> {
  return page.evaluate(() => {
    const ec1 = (window as any).__ec1;
    const ec2 = (window as any).__ec2;
    return {
      state1: {
        text: ec1.text as string,
        selectionStart: ec1.selectionStart as number,
        selectionEnd: ec1.selectionEnd as number,
      },
      state2: {
        text: ec2.text as string,
        selectionStart: ec2.selectionStart as number,
        selectionEnd: ec2.selectionEnd as number,
      },
      events1: (window as any).__events1 ?? [],
      events2: (window as any).__events2 ?? [],
    };
  });
}

test.describe("Fuzz multi-EditContext: native vs polyfill", () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "Chromium only");
    test.skip(
      testInfo.project.name !== "chromium-native",
      "Fuzzer manages its own native + polyfill contexts",
    );
  });

  for (let i = 0; i < ITERATIONS; i++) {
    const seed = SEED_OFFSET + i;

    test(`multi seed ${seed}`, async ({ browser }) => {
      const sequence = generateMultiSequence(seed, SEQUENCE_LENGTH);

      const nativeCtx = await browser.newContext();
      const nativePage = await nativeCtx.newPage();
      await navigatePage(nativePage, HTML);
      await setupMultiEditContext(nativePage);

      const polyfillCtx = await browser.newContext();
      await polyfillCtx.addInitScript(DELETE_NATIVE_EDIT_CONTEXT);
      await polyfillCtx.addInitScript(polyfillSource);
      const polyfillPage = await polyfillCtx.newPage();
      await navigatePage(polyfillPage, HTML);
      await setupMultiEditContext(polyfillPage);

      for (const action of sequence) {
        const nativeOk = await executeMultiActionWithTimeout(nativePage, action);
        if (!nativeOk) continue;
        await executeMultiActionWithTimeout(polyfillPage, action);
      }

      const seqDump = formatSequence(sequence);

      const nativeResult = await getMultiState(nativePage);
      const polyfillResult = await getMultiState(polyfillPage);

      expect(
        polyfillResult.state1,
        `Target1 state mismatch (multi seed ${seed}):\n${seqDump}`,
      ).toEqual(nativeResult.state1);

      expect(
        polyfillResult.state2,
        `Target2 state mismatch (multi seed ${seed}):\n${seqDump}`,
      ).toEqual(nativeResult.state2);

      expect(
        polyfillResult.events1,
        `Target1 event log mismatch (multi seed ${seed}):\n${seqDump}`,
      ).toEqual(nativeResult.events1);

      expect(
        polyfillResult.events2,
        `Target2 event log mismatch (multi seed ${seed}):\n${seqDump}`,
      ).toEqual(nativeResult.events2);

      await nativeCtx.close();
      await polyfillCtx.close();
    });
  }
});
