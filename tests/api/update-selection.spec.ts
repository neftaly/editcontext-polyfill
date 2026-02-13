import { test, expect } from "../fixtures/test-base.js";

const HTML = `<div id="target"></div>`;

test.describe("EditContext.updateSelection", () => {
  test("basic: sets both values", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "abcdef" });
      ec.updateSelection(2, 5);
      return {
        selectionStart: ec.selectionStart,
        selectionEnd: ec.selectionEnd,
      };
    });
    expect(result).toEqual({ selectionStart: 2, selectionEnd: 5 });
  });

  test("backward selection: preserves order (start > end)", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "abcdef" });
      ec.updateSelection(5, 2);
      return {
        selectionStart: ec.selectionStart,
        selectionEnd: ec.selectionEnd,
      };
    });
    expect(result).toEqual({ selectionStart: 5, selectionEnd: 2 });
  });

  test("clamping: values beyond text.length clamped", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "hello" });
      ec.updateSelection(100, 200);
      return {
        selectionStart: ec.selectionStart,
        selectionEnd: ec.selectionEnd,
      };
    });
    expect(result).toEqual({ selectionStart: 5, selectionEnd: 5 });
  });

  test("does NOT fire textupdate event", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "abc" });
      let fired = false;
      ec.addEventListener("textupdate", () => {
        fired = true;
      });
      ec.updateSelection(1, 2);
      return fired;
    });
    expect(result).toBe(false);
  });
});
