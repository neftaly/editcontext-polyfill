import { test, expect } from "../fixtures/test-base.js";

const HTML = `<div id="target"></div>`;

test.describe("EditContext constructor", () => {
  test("default constructor: text='', selectionStart=0, selectionEnd=0", async ({
    page,
    setContent,
  }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext();
      return {
        text: ec.text,
        selectionStart: ec.selectionStart,
        selectionEnd: ec.selectionEnd,
      };
    });
    expect(result).toEqual({ text: "", selectionStart: 0, selectionEnd: 0 });
  });

  test("constructor with text preserves text", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "hello" });
      return { text: ec.text };
    });
    expect(result.text).toBe("hello");
  });

  test("constructor clamps selectionStart to text.length", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "ab", selectionStart: 5 });
      return { selectionStart: ec.selectionStart, selectionEnd: ec.selectionEnd };
    });
    expect(result.selectionStart).toBe(2);
    expect(result.selectionEnd).toBe(0);
  });

  test("constructor clamps selectionEnd to text.length", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "ab", selectionEnd: 10 });
      return { selectionStart: ec.selectionStart, selectionEnd: ec.selectionEnd };
    });
    expect(result.selectionStart).toBe(0);
    expect(result.selectionEnd).toBe(2);
  });

  test("constructor with all args in range preserves exact values", async ({
    page,
    setContent,
  }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({
        text: "abcdef",
        selectionStart: 2,
        selectionEnd: 4,
      });
      return {
        text: ec.text,
        selectionStart: ec.selectionStart,
        selectionEnd: ec.selectionEnd,
      };
    });
    expect(result).toEqual({
      text: "abcdef",
      selectionStart: 2,
      selectionEnd: 4,
    });
  });

  test("characterBoundsRangeStart defaults to 0", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext();
      return ec.characterBoundsRangeStart;
    });
    expect(result).toBe(0);
  });

  test("characterBounds() returns empty array by default", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext();
      return ec.characterBounds().length;
    });
    expect(result).toBe(0);
  });

  test("attachedElements() returns empty array when not bound", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext();
      return ec.attachedElements().length;
    });
    expect(result).toBe(0);
  });
});
