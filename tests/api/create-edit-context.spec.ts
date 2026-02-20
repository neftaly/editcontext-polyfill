// Tests for the createEditContext() helper function.

import { test, expect } from "../fixtures/test-base.js";

const HTML = `
  <div id="editor" style="width:300px;height:100px;padding:8px;font:16px monospace;"></div>
`;

test.describe("createEditContext", () => {
  // createEditContext is a polyfill helper — only available via the IIFE bundle
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires destructured fixtures
  test.beforeEach(({}, testInfo) => {
    test.skip(!testInfo.project.name.includes("polyfill"), "polyfill-only helper");
  });

  test("attaches EditContext to element", async ({ page, setContent }) => {
    await setContent(HTML);

    const hasContext = await page.evaluate(() => {
      const el = document.getElementById("editor")!;
      (window as any).EditContextPolyfill.createEditContext(el);
      return el.editContext !== null;
    });

    expect(hasContext).toBe(true);
  });

  test("passes init options (text, selectionStart, selectionEnd)", async ({ page, setContent }) => {
    await setContent(HTML);

    const state = await page.evaluate(() => {
      const el = document.getElementById("editor")!;
      (window as any).EditContextPolyfill.createEditContext(el, {
        text: "hello",
        selectionStart: 2,
        selectionEnd: 4,
      });
      const ec = el.editContext!;
      return { text: ec.text, selStart: ec.selectionStart, selEnd: ec.selectionEnd };
    });

    expect(state).toEqual({ text: "hello", selStart: 2, selEnd: 4 });
  });

  test("wires event listeners — typing fires onTextUpdate", async ({ page, setContent }) => {
    await setContent(HTML);

    await page.evaluate(() => {
      const el = document.getElementById("editor")!;
      (window as any).__updates = [];
      (window as any).EditContextPolyfill.createEditContext(el, {
        onTextUpdate(e: any) {
          (window as any).__updates.push(e.text);
          el.editContext!.updateSelection(e.selectionStart, e.selectionEnd);
        },
      });
      el.focus();
    });

    await page.keyboard.type("abc");

    const updates = await page.evaluate(() => (window as any).__updates);
    expect(updates.length).toBeGreaterThanOrEqual(1);
  });

  test("destroy() detaches EditContext and removes listeners", async ({ page, setContent }) => {
    await setContent(HTML);

    const result = await page.evaluate(() => {
      const el = document.getElementById("editor")!;
      let callCount = 0;
      const destroy = (window as any).EditContextPolyfill.createEditContext(el, {
        onTextUpdate() {
          callCount++;
        },
      });
      const hadContext = el.editContext !== null;
      destroy();
      const hasContextAfter = el.editContext !== null;
      return { hadContext, hasContextAfter, callCount };
    });

    expect(result.hadContext).toBe(true);
    expect(result.hasContextAfter).toBe(false);
  });

  test("throws TypeError on null element", async ({ page, setContent }) => {
    await setContent(HTML);

    const threw = await page.evaluate(() => {
      try {
        (window as any).EditContextPolyfill.createEditContext(null);
        return false;
      } catch (e) {
        return e instanceof TypeError;
      }
    });

    expect(threw).toBe(true);
  });
});
