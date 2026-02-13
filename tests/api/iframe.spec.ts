import { test, expect } from "../fixtures/test-base.js";
import type { Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const polyfillSource = fs.readFileSync(path.resolve("dist/editcontext-polyfill.iife.js"), "utf-8");

/**
 * Set up the iframe with the polyfill.
 *
 * In the "chromium-polyfill" project, addInitScript already deleted native
 * EditContext and injected the polyfill into every frame (including iframes).
 * In that case we must NOT inject a second copy -- the double-installation
 * creates two competing sets of focus-management listeners that race with
 * each other and drop keyboard input.
 *
 * In the "chromium-native" project, addInitScript was not called, so we
 * must inject the polyfill ourselves.
 */
async function setupIframePolyfill(page: Page, bodyHtml: string, source: string): Promise<void> {
  await page.evaluate(
    ({ bodyHtml: html, source: src }) => {
      const iframe = document.getElementById("frame") as HTMLIFrameElement;
      const doc = iframe.contentDocument!;
      doc.body.innerHTML = html;

      const win = iframe.contentWindow! as unknown as Record<string, unknown>;

      // If the polyfill was already injected by addInitScript (polyfill projects),
      // EditContext will be defined and will NOT be the native implementation
      // (native was deleted by the addInitScript DELETE_NATIVE_EDIT_CONTEXT step).
      // In that case, skip manual injection to avoid double-installation.
      if (typeof win.EditContext === "undefined") {
        // Native project: manually inject polyfill into the iframe
        delete win.TextUpdateEvent;
        delete win.TextFormatUpdateEvent;
        delete win.CharacterBoundsUpdateEvent;
        delete win.TextFormat;
        const script = doc.createElement("script");
        script.textContent = src;
        doc.head.appendChild(script);
      }
    },
    { bodyHtml: bodyHtml, source: source },
  );
}

/**
 * After clicking an EditContext element inside an iframe, wait for:
 * 1. The polyfill's hidden textarea inside the shadow root to be focused
 * 2. The polyfill's deferred mouse-handler setTimeout(0) sync to complete
 *
 * The mouse handler schedules a `setTimeout(0)` re-sync of the textarea
 * after every click (see scheduleSync in mouse-handler.ts). If keyboard
 * events arrive before this sync fires, the sync will reset textarea.value
 * mid-typing, causing dropped characters. Flushing the timer via a
 * setTimeout(0) in the iframe's event loop ensures the sync completes
 * before we start typing.
 */
async function waitForIframeFocus(
  page: Page,
  iframeSelector: string,
  targetSelector: string,
): Promise<void> {
  // Step 1: Wait for the hidden textarea to be created and focused
  await page.waitForFunction(
    ({ iframeSel, targetSel }) => {
      const iframe = document.querySelector(iframeSel) as HTMLIFrameElement | null;
      if (!iframe?.contentDocument) return false;
      const doc = iframe.contentDocument;
      const target = doc.querySelector(targetSel) as HTMLElement | null;
      if (!target) return false;

      // Polyfill path: hidden textarea inside shadow root should be focused.
      // The polyfill pre-attaches a shadow root via ensureShadowRoot() in
      // manageElement(), so we MUST check that a textarea exists within it
      // (created by activate()) AND that it has focus.
      if (target.shadowRoot) {
        const textarea = target.shadowRoot.querySelector("textarea");
        if (!textarea) return false; // Shadow root exists but textarea not yet created
        if (doc.activeElement === textarea) return true;
        if (textarea === target.shadowRoot.activeElement) return true;
        return false;
      }

      // No shadow root: native EditContext or fallback.
      const active = doc.activeElement;
      if (active === target) return true;
      if (active instanceof HTMLTextAreaElement && target.contains(active)) return true;

      return false;
    },
    { iframeSel: iframeSelector, targetSel: targetSelector },
    { timeout: 5000 },
  );

  // Step 2: Flush the deferred setTimeout(0) sync from the mouse handler.
  // The mouse handler's scheduleSync() uses setTimeout(0) to re-sync the
  // textarea value/selection after Chrome asynchronously resets them.
  // We must wait for that to complete before sending keyboard input.
  // A setTimeout(0) inside the iframe's event loop will fire AFTER
  // any existing setTimeout(0) callbacks (FIFO ordering).
  await page.evaluate((iframeSel) => {
    const iframe = document.querySelector(iframeSel) as HTMLIFrameElement;
    const win = iframe?.contentWindow;
    if (!win) return Promise.resolve();
    return new Promise<void>((resolve) => win.setTimeout(resolve, 0));
  }, iframeSelector);
}

/**
 * Wait for an EditContext property inside the iframe to reach an expected value.
 * This replaces brittle patterns like type() then immediately evaluate() + expect().
 */
async function waitForECText(page: Page, ecAccessor: string, expectedText: string): Promise<void> {
  await page.waitForFunction(
    ({ accessor, expected }) => {
      const iframe = document.getElementById("frame") as HTMLIFrameElement;
      const win = iframe?.contentWindow as unknown as Record<string, unknown>;
      if (!win) return false;
      const ec = win[accessor] as { text: string } | undefined;
      return ec?.text === expected;
    },
    { accessor: ecAccessor, expected: expectedText },
    { timeout: 5000 },
  );
}

test.describe("EditContext inside an iframe", () => {
  test("basic text insertion works inside iframe", async ({ page, setContent }) => {
    await setContent(`<iframe id="frame" style="width:400px;height:200px;"></iframe>`);

    await setupIframePolyfill(
      page,
      '<div id="target" style="width:200px;height:100px;"></div>',
      polyfillSource,
    );

    await page.evaluate(() => {
      const iframe = document.getElementById("frame") as HTMLIFrameElement;
      const win = iframe.contentWindow! as unknown as Record<string, unknown>;
      const doc = iframe.contentDocument!;
      const el = doc.getElementById("target")!;
      const EC = win.EditContext as typeof EditContext;
      const ec = new EC();
      el.editContext = ec;
      el.focus();
      win.__ec = ec;
    });

    const frame = page.frameLocator("#frame");
    await frame.locator("#target").click();
    await waitForIframeFocus(page, "#frame", "#target");
    await page.keyboard.type("hello");

    await waitForECText(page, "__ec", "hello");

    const result = await page.evaluate(() => {
      const iframe = document.getElementById("frame") as HTMLIFrameElement;
      const ec = (iframe.contentWindow as unknown as Record<string, unknown>).__ec as EditContext;
      return { text: ec.text, selStart: ec.selectionStart, selEnd: ec.selectionEnd };
    });
    expect(result.text).toBe("hello");
    expect(result.selStart).toBe(5);
    expect(result.selEnd).toBe(5);
  });

  test("textupdate event fires correctly inside iframe", async ({ page, setContent }) => {
    await setContent(`<iframe id="frame" style="width:400px;height:200px;"></iframe>`);

    await setupIframePolyfill(
      page,
      '<div id="target" style="width:200px;height:100px;"></div>',
      polyfillSource,
    );

    await page.evaluate(() => {
      const iframe = document.getElementById("frame") as HTMLIFrameElement;
      const win = iframe.contentWindow! as unknown as Record<string, unknown>;
      const doc = iframe.contentDocument!;
      const el = doc.getElementById("target")!;
      const EC = win.EditContext as typeof EditContext;
      const ec = new EC({ text: "abc", selectionStart: 1, selectionEnd: 3 });
      el.editContext = ec;
      el.focus();
      win.__ec = ec;
      win.__lastTextUpdate = null;
      ec.addEventListener("textupdate", ((e: TextUpdateEvent) => {
        win.__lastTextUpdate = {
          text: e.text,
          updateRangeStart: e.updateRangeStart,
          updateRangeEnd: e.updateRangeEnd,
          selectionStart: e.selectionStart,
          selectionEnd: e.selectionEnd,
        };
      }) as EventListener);
    });

    const frame = page.frameLocator("#frame");
    await frame.locator("#target").click();
    await waitForIframeFocus(page, "#frame", "#target");
    await page.keyboard.type("X");

    // Wait for the textupdate event to have fired
    await page.waitForFunction(
      () => {
        const iframe = document.getElementById("frame") as HTMLIFrameElement;
        return (
          (iframe.contentWindow as unknown as Record<string, unknown>).__lastTextUpdate != null
        );
      },
      null,
      { timeout: 5000 },
    );

    const result = await page.evaluate(() => {
      const iframe = document.getElementById("frame") as HTMLIFrameElement;
      return (iframe.contentWindow as unknown as Record<string, unknown>).__lastTextUpdate;
    });
    expect(result).toEqual({
      text: "X",
      updateRangeStart: 1,
      updateRangeEnd: 3,
      selectionStart: 2,
      selectionEnd: 2,
    });
  });

  test("focus and blur work correctly inside iframe", async ({ page, setContent }) => {
    await setContent(`<iframe id="frame" style="width:400px;height:200px;"></iframe>`);

    await setupIframePolyfill(
      page,
      '<div id="target" style="width:200px;height:100px;"></div>' +
        '<div id="other" tabindex="0" style="width:200px;height:100px;"></div>',
      polyfillSource,
    );

    await page.evaluate(() => {
      const iframe = document.getElementById("frame") as HTMLIFrameElement;
      const win = iframe.contentWindow! as unknown as Record<string, unknown>;
      const doc = iframe.contentDocument!;
      const el = doc.getElementById("target")!;
      const EC = win.EditContext as typeof EditContext;
      const ec = new EC();
      el.editContext = ec;
      el.focus();
      win.__ec = ec;
    });

    const frame = page.frameLocator("#frame");
    await frame.locator("#target").click();
    await waitForIframeFocus(page, "#frame", "#target");
    await page.keyboard.type("ab");

    // Wait for the text to be captured before blurring
    await waitForECText(page, "__ec", "ab");

    // Blur by clicking the non-EditContext element
    await frame.locator("#other").click();

    // Wait for focus to actually move away from the target
    await page.waitForFunction(
      () => {
        const iframe = document.getElementById("frame") as HTMLIFrameElement;
        const doc = iframe.contentDocument!;
        const target = doc.getElementById("target")!;
        // Focus should have moved away from the target's shadow textarea
        if (target.shadowRoot) {
          const textarea = target.shadowRoot.querySelector("textarea");
          if (textarea && doc.activeElement === textarea) return false;
        }
        return true;
      },
      null,
      { timeout: 5000 },
    );

    await page.keyboard.type("cd");

    // Small delay for any stray input events to settle
    await page.waitForTimeout(50);

    const result = await page.evaluate(() => {
      const iframe = document.getElementById("frame") as HTMLIFrameElement;
      const ec = (iframe.contentWindow as unknown as Record<string, unknown>).__ec as EditContext;
      return { text: ec.text };
    });
    // "cd" should NOT have been captured after blur
    expect(result.text).toBe("ab");
  });

  test("document.activeElement inside iframe returns EditContext host", async ({
    page,
    setContent,
  }) => {
    await setContent(`<iframe id="frame" style="width:400px;height:200px;"></iframe>`);

    await setupIframePolyfill(
      page,
      '<div id="target" style="width:200px;height:100px;"></div>',
      polyfillSource,
    );

    await page.evaluate(() => {
      const iframe = document.getElementById("frame") as HTMLIFrameElement;
      const win = iframe.contentWindow! as unknown as Record<string, unknown>;
      const doc = iframe.contentDocument!;
      const el = doc.getElementById("target")!;
      const EC = win.EditContext as typeof EditContext;
      const ec = new EC();
      el.editContext = ec;
      el.focus();
    });

    const frame = page.frameLocator("#frame");
    await frame.locator("#target").click();
    await waitForIframeFocus(page, "#frame", "#target");

    const activeId = await page.evaluate(() => {
      const iframe = document.getElementById("frame") as HTMLIFrameElement;
      return iframe.contentDocument!.activeElement?.id;
    });
    expect(activeId).toBe("target");
  });

  test("multiple EditContext elements inside iframe switch correctly", async ({
    page,
    setContent,
  }) => {
    await setContent(`<iframe id="frame" style="width:400px;height:200px;"></iframe>`);

    await setupIframePolyfill(
      page,
      '<div id="a" style="width:100px;height:50px;"></div>' +
        '<div id="b" style="width:100px;height:50px;"></div>',
      polyfillSource,
    );

    await page.evaluate(() => {
      const iframe = document.getElementById("frame") as HTMLIFrameElement;
      const win = iframe.contentWindow! as unknown as Record<string, unknown>;
      const doc = iframe.contentDocument!;
      const EC = win.EditContext as typeof EditContext;

      const elA = doc.getElementById("a")!;
      const ecA = new EC();
      elA.editContext = ecA;

      const elB = doc.getElementById("b")!;
      const ecB = new EC();
      elB.editContext = ecB;

      win.__ecA = ecA;
      win.__ecB = ecB;
    });

    const frame = page.frameLocator("#frame");

    // Click A, wait for focus, then type
    await frame.locator("#a").click();
    await waitForIframeFocus(page, "#frame", "#a");
    await page.keyboard.type("A");

    // Wait for the text to land before switching focus
    await waitForECText(page, "__ecA", "A");

    // Click B, wait for focus, then type
    await frame.locator("#b").click();
    await waitForIframeFocus(page, "#frame", "#b");
    await page.keyboard.type("B");

    await waitForECText(page, "__ecB", "B");

    const result = await page.evaluate(() => {
      const iframe = document.getElementById("frame") as HTMLIFrameElement;
      const win = iframe.contentWindow as unknown as Record<string, unknown>;
      return {
        textA: (win.__ecA as EditContext).text,
        textB: (win.__ecB as EditContext).text,
      };
    });
    expect(result.textA).toBe("A");
    expect(result.textB).toBe("B");
  });

  test("delete (backspace) works inside iframe", async ({ page, setContent }) => {
    await setContent(`<iframe id="frame" style="width:400px;height:200px;"></iframe>`);

    await setupIframePolyfill(
      page,
      '<div id="target" style="width:200px;height:100px;"></div>',
      polyfillSource,
    );

    await page.evaluate(() => {
      const iframe = document.getElementById("frame") as HTMLIFrameElement;
      const win = iframe.contentWindow! as unknown as Record<string, unknown>;
      const doc = iframe.contentDocument!;
      const el = doc.getElementById("target")!;
      const EC = win.EditContext as typeof EditContext;
      const ec = new EC({ text: "hello", selectionStart: 5, selectionEnd: 5 });
      el.editContext = ec;
      el.focus();
      win.__ec = ec;
    });

    const frame = page.frameLocator("#frame");
    await frame.locator("#target").click();
    await waitForIframeFocus(page, "#frame", "#target");
    await page.keyboard.press("Backspace");

    // Wait for the backspace to be processed
    await waitForECText(page, "__ec", "hell");

    const result = await page.evaluate(() => {
      const iframe = document.getElementById("frame") as HTMLIFrameElement;
      const ec = (iframe.contentWindow as unknown as Record<string, unknown>).__ec as EditContext;
      return { text: ec.text, selStart: ec.selectionStart };
    });
    expect(result.text).toBe("hell");
    expect(result.selStart).toBe(4);
  });
});
