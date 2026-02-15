// Regression test: updateSelection() followed immediately by real CDP IME input
// (Input.imeSetComposition / Input.insertText).
//
// This exercises the scenario where calling updateSelection() moves the logical
// cursor, but the hidden textarea's internal cursor might not have synced yet.
// Unlike the unit test in composition.spec.ts (which uses the polyfill's
// internal _setComposition), this test uses real CDP IME commands so the input
// travels through the browser's actual IME pipeline.
//
// Uses CDP Input.imeSetComposition / Input.insertText for real IME input.

import { test, expect, chromium, type Page, type CDPSession } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  DELETE_NATIVE_EDIT_CONTEXT,
  setupEditContextWithComposition,
  executeImeActionWithTimeout,
  getState,
  getEventLog,
} from "../fuzz/helpers.js";

const polyfillSource = fs.readFileSync(path.resolve("dist/editcontext-polyfill.iife.js"), "utf-8");

const HTML = `<!DOCTYPE html>
<div id="target" style="width:200px;height:100px;"></div>`;

async function navigatePage(page: Page, html: string): Promise<void> {
  await page.route("https://ime-regression.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await page.goto("https://ime-regression.test/");
}

test.describe("IME regression: updateSelection then real CDP IME", () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "Chromium only");
    test.skip(
      testInfo.project.name !== "chromium-native",
      "IME regression test manages its own native + polyfill contexts",
    );
  });

  test("updateSelection to middle, then IME compose and commit", async () => {
    const browser = await chromium.launch();

    try {
      // -- Native context --
      const nativeCtx = await browser.newContext();
      const nativePage = await nativeCtx.newPage();
      const nativeClient = await nativePage.context().newCDPSession(nativePage);
      await navigatePage(nativePage, HTML);
      await setupEditContextWithComposition(nativePage);

      // -- Polyfill context --
      const polyfillCtx = await browser.newContext();
      await polyfillCtx.addInitScript(DELETE_NATIVE_EDIT_CONTEXT);
      await polyfillCtx.addInitScript(polyfillSource);
      const polyfillPage = await polyfillCtx.newPage();
      const polyfillClient = await polyfillPage.context().newCDPSession(polyfillPage);
      await navigatePage(polyfillPage, HTML);
      await setupEditContextWithComposition(polyfillPage);

      // Set initial text "hello world" with cursor at end (position 11)
      const setupAction = { type: "type" as const, text: "hello world" };
      await executeImeActionWithTimeout(nativePage, nativeClient, setupAction);
      await executeImeActionWithTimeout(polyfillPage, polyfillClient, setupAction);

      // Clear event logs before the scenario under test
      await nativePage.evaluate(() => {
        (window as any).__events = [];
      });
      await polyfillPage.evaluate(() => {
        (window as any).__events = [];
      });

      // Move cursor to position 5 (between "hello" and " world")
      const updateSelectionAction = {
        type: "updateSelection" as const,
        start: 5,
        end: 5,
      };
      await executeImeActionWithTimeout(nativePage, nativeClient, updateSelectionAction);
      await executeImeActionWithTimeout(polyfillPage, polyfillClient, updateSelectionAction);

      // Immediately start IME composition at the new cursor position
      const composeAction = {
        type: "imeSetComposition" as const,
        text: "\u304b", // か
        selectionStart: 1,
        selectionEnd: 1,
      };
      const nativeComposeOk = await executeImeActionWithTimeout(
        nativePage,
        nativeClient,
        composeAction,
      );
      const polyfillComposeOk = await executeImeActionWithTimeout(
        polyfillPage,
        polyfillClient,
        composeAction,
      );
      expect(nativeComposeOk, "Native imeSetComposition should not time out").toBe(true);
      expect(polyfillComposeOk, "Polyfill imeSetComposition should not time out").toBe(true);

      // Commit the composition
      const commitAction = {
        type: "imeCommitText" as const,
        text: "\u304b", // か
      };
      const nativeCommitOk = await executeImeActionWithTimeout(
        nativePage,
        nativeClient,
        commitAction,
      );
      const polyfillCommitOk = await executeImeActionWithTimeout(
        polyfillPage,
        polyfillClient,
        commitAction,
      );
      expect(nativeCommitOk, "Native imeCommitText should not time out").toBe(true);
      expect(polyfillCommitOk, "Polyfill imeCommitText should not time out").toBe(true);

      // Compare final state
      const nativeState = await getState(nativePage);
      const polyfillState = await getState(polyfillPage);
      expect(polyfillState, "Final state should match native").toEqual(nativeState);

      // Verify the composition landed at position 5, not at the end
      expect(nativeState!.text).toBe("hello\u304b world");
      expect(nativeState!.selectionStart).toBe(6);
      expect(nativeState!.selectionEnd).toBe(6);

      // Compare textupdate event logs
      const nativeEvents = await getEventLog(nativePage);
      const polyfillEvents = await getEventLog(polyfillPage);
      expect(polyfillEvents, "textupdate event log should match native").toEqual(nativeEvents);

      await nativeCtx.close();
      await polyfillCtx.close();
    } finally {
      await browser.close();
    }
  });

  test("updateSelection to position 0, then IME compose and commit", async () => {
    const browser = await chromium.launch();

    try {
      // -- Native context --
      const nativeCtx = await browser.newContext();
      const nativePage = await nativeCtx.newPage();
      const nativeClient = await nativePage.context().newCDPSession(nativePage);
      await navigatePage(nativePage, HTML);
      await setupEditContextWithComposition(nativePage);

      // -- Polyfill context --
      const polyfillCtx = await browser.newContext();
      await polyfillCtx.addInitScript(DELETE_NATIVE_EDIT_CONTEXT);
      await polyfillCtx.addInitScript(polyfillSource);
      const polyfillPage = await polyfillCtx.newPage();
      const polyfillClient = await polyfillPage.context().newCDPSession(polyfillPage);
      await navigatePage(polyfillPage, HTML);
      await setupEditContextWithComposition(polyfillPage);

      // Set initial text "hello world" with cursor at end (position 11)
      const setupAction = { type: "type" as const, text: "hello world" };
      await executeImeActionWithTimeout(nativePage, nativeClient, setupAction);
      await executeImeActionWithTimeout(polyfillPage, polyfillClient, setupAction);

      // Clear event logs before the scenario under test
      await nativePage.evaluate(() => {
        (window as any).__events = [];
      });
      await polyfillPage.evaluate(() => {
        (window as any).__events = [];
      });

      // Move cursor to position 0 (beginning of text)
      const updateSelectionAction = {
        type: "updateSelection" as const,
        start: 0,
        end: 0,
      };
      await executeImeActionWithTimeout(nativePage, nativeClient, updateSelectionAction);
      await executeImeActionWithTimeout(polyfillPage, polyfillClient, updateSelectionAction);

      // Immediately start IME composition at the beginning
      const composeAction = {
        type: "imeSetComposition" as const,
        text: "\u3042", // あ
        selectionStart: 1,
        selectionEnd: 1,
      };
      const nativeComposeOk = await executeImeActionWithTimeout(
        nativePage,
        nativeClient,
        composeAction,
      );
      const polyfillComposeOk = await executeImeActionWithTimeout(
        polyfillPage,
        polyfillClient,
        composeAction,
      );
      expect(nativeComposeOk, "Native imeSetComposition should not time out").toBe(true);
      expect(polyfillComposeOk, "Polyfill imeSetComposition should not time out").toBe(true);

      // Commit the composition
      const commitAction = {
        type: "imeCommitText" as const,
        text: "\u3042", // あ
      };
      const nativeCommitOk = await executeImeActionWithTimeout(
        nativePage,
        nativeClient,
        commitAction,
      );
      const polyfillCommitOk = await executeImeActionWithTimeout(
        polyfillPage,
        polyfillClient,
        commitAction,
      );
      expect(nativeCommitOk, "Native imeCommitText should not time out").toBe(true);
      expect(polyfillCommitOk, "Polyfill imeCommitText should not time out").toBe(true);

      // Compare final state
      const nativeState = await getState(nativePage);
      const polyfillState = await getState(polyfillPage);
      expect(polyfillState, "Final state should match native").toEqual(nativeState);

      // Verify the composition landed at position 0, not at the end
      expect(nativeState!.text).toBe("\u3042hello world");
      expect(nativeState!.selectionStart).toBe(1);
      expect(nativeState!.selectionEnd).toBe(1);

      // Compare textupdate event logs
      const nativeEvents = await getEventLog(nativePage);
      const polyfillEvents = await getEventLog(polyfillPage);
      expect(polyfillEvents, "textupdate event log should match native").toEqual(nativeEvents);

      await nativeCtx.close();
      await polyfillCtx.close();
    } finally {
      await browser.close();
    }
  });
});
