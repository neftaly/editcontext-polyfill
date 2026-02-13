import { test, expect } from "../fixtures/test-base.js";

const HTML = `<div id="target" style="width:200px;height:100px;"></div>`;

test.describe("EditContext insert text (keyboard typing)", () => {
  test("single character insertion", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext();
      el.editContext = ec;
      el.focus();
      (window as any).__ec = ec;
    });

    await page.keyboard.type("a");

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return {
        text: ec.text,
        selStart: ec.selectionStart,
        selEnd: ec.selectionEnd,
      };
    });
    expect(result.text).toBe("a");
    expect(result.selStart).toBe(1);
    expect(result.selEnd).toBe(1);
  });

  test("multi-character insertion (sequential keys)", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext();
      el.editContext = ec;
      el.focus();
      (window as any).__ec = ec;
    });

    await page.keyboard.type("hello");

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return { text: ec.text, selStart: ec.selectionStart };
    });
    expect(result.text).toBe("hello");
    expect(result.selStart).toBe(5);
  });

  test("insertion replaces non-collapsed selection", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext({
        text: "abcdef",
        selectionStart: 1,
        selectionEnd: 4,
      });
      el.editContext = ec;
      el.focus();
      (window as any).__ec = ec;
    });

    await page.keyboard.type("X");

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return { text: ec.text, selStart: ec.selectionStart };
    });
    expect(result.text).toBe("aXef");
    expect(result.selStart).toBe(2);
  });

  test("textupdate event has correct properties", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext({
        text: "abcdef",
        selectionStart: 2,
        selectionEnd: 4,
      });
      el.editContext = ec;
      el.focus();
      (window as any).__ec = ec;
      ec.addEventListener("textupdate", ((e: TextUpdateEvent) => {
        (window as any).__lastTextUpdate = {
          text: e.text,
          updateRangeStart: e.updateRangeStart,
          updateRangeEnd: e.updateRangeEnd,
          selectionStart: e.selectionStart,
          selectionEnd: e.selectionEnd,
        };
      }) as EventListener);
    });

    await page.keyboard.type("X");

    const result = await page.evaluate(() => (window as any).__lastTextUpdate);
    expect(result).toEqual({
      text: "X",
      updateRangeStart: 2,
      updateRangeEnd: 4,
      selectionStart: 3,
      selectionEnd: 3,
    });
  });

  test("selection moves to end of inserted text", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext({
        text: "abc",
        selectionStart: 1,
        selectionEnd: 1,
      });
      el.editContext = ec;
      el.focus();
      (window as any).__ec = ec;
    });

    await page.keyboard.type("XYZ");

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return {
        text: ec.text,
        selStart: ec.selectionStart,
        selEnd: ec.selectionEnd,
      };
    });
    expect(result.text).toBe("aXYZbc");
    expect(result.selStart).toBe(4);
    expect(result.selEnd).toBe(4);
  });
});
