// Shadow DOM fuzzer variant: same as the base fuzzer, but the target is a
// custom element with a pre-existing open shadow root containing a <slot>.
// Tests that polyfill correctly reuses existing shadow roots and that event
// retargeting works.

import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { generateSequence } from "./sequence-generator.js";
import {
  DELETE_NATIVE_EDIT_CONTEXT,
  formatSequence,
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
<custom-editor id="target" style="width:200px;height:100px;"></custom-editor>
<div id="other" tabindex="0" style="width:100px;height:50px;"></div>
<script>
  class CustomEditor extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = "<slot></slot>";
    }
  }
  customElements.define("custom-editor", CustomEditor);
</script>`;

async function navigatePage(page: Page, html: string): Promise<void> {
  await page.route("https://fuzz-shadow.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await page.goto("https://fuzz-shadow.test/");
}

/** Setup for shadow DOM variant — EditContext goes on the custom element host. */
async function setupShadowEditContext(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.getElementById("target")!;
    const ec = new EditContext();
    el.editContext = ec;
    el.focus();
    (window as any).__ec = ec;
    (window as any).__el = el;
    (window as any).__events = [];
    (window as any).__beforeInputEvents = [];

    ec.addEventListener("textupdate", ((e: TextUpdateEvent) => {
      (window as any).__events.push({
        text: e.text,
        updateRangeStart: e.updateRangeStart,
        updateRangeEnd: e.updateRangeEnd,
        selectionStart: e.selectionStart,
        selectionEnd: e.selectionEnd,
      });
    }) as EventListener);

    el.addEventListener("beforeinput", (e: InputEvent) => {
      (window as any).__beforeInputEvents.push({
        inputType: e.inputType,
        data: e.data,
      });
    });
  });
}

test.describe("Fuzz shadow DOM: native vs polyfill", () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "Chromium only");
    test.skip(
      testInfo.project.name !== "chromium-native",
      "Fuzzer manages its own native + polyfill contexts",
    );
  });

  for (let i = 0; i < ITERATIONS; i++) {
    const seed = SEED_OFFSET + i;

    test(`shadow seed ${seed}`, async ({ browser }) => {
      const sequence = generateSequence(seed, SEQUENCE_LENGTH);

      const nativeCtx = await browser.newContext({
        permissions: ["clipboard-read", "clipboard-write"],
      });
      const nativePage = await nativeCtx.newPage();
      await navigatePage(nativePage, HTML);
      await setupShadowEditContext(nativePage);

      const polyfillCtx = await browser.newContext({
        permissions: ["clipboard-read", "clipboard-write"],
      });
      await polyfillCtx.addInitScript(DELETE_NATIVE_EDIT_CONTEXT);
      await polyfillCtx.addInitScript(polyfillSource);
      const polyfillPage = await polyfillCtx.newPage();
      await navigatePage(polyfillPage, HTML);
      await setupShadowEditContext(polyfillPage);

      for (const action of sequence) {
        const nativeOk = await executeActionWithTimeout(nativePage, action);
        if (!nativeOk) continue;
        await executeActionWithTimeout(polyfillPage, action);
      }

      const seqDump = formatSequence(sequence);

      const nativeState = await getState(nativePage);
      const polyfillState = await getState(polyfillPage);
      expect(polyfillState, `State mismatch (shadow seed ${seed}):\n${seqDump}`).toEqual(
        nativeState,
      );

      const nativeEvents = await getEventLog(nativePage);
      const polyfillEvents = await getEventLog(polyfillPage);
      expect(polyfillEvents, `Event log mismatch (shadow seed ${seed}):\n${seqDump}`).toEqual(
        nativeEvents,
      );

      const nativeBeforeInput = await getBeforeInputLog(nativePage);
      const polyfillBeforeInput = await getBeforeInputLog(polyfillPage);
      expect(
        polyfillBeforeInput,
        `beforeinput log mismatch (shadow seed ${seed}):\n${seqDump}`,
      ).toEqual(nativeBeforeInput);

      const nativeHtml = await getInnerHTML(nativePage);
      const polyfillHtml = await getInnerHTML(polyfillPage);
      expect(polyfillHtml, `innerHTML mismatch (shadow seed ${seed}):\n${seqDump}`).toEqual(
        nativeHtml,
      );

      await nativeCtx.close();
      await polyfillCtx.close();
    });
  }
});
