import { test, expect } from "../fixtures/test-base.js";

const HTML = `<div id="target"></div>`;

test.describe("EditContext.updateText", () => {
  test("basic replacement", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "abcdef" });
      ec.updateText(0, 3, "xyz");
      return ec.text;
    });
    expect(result).toBe("xyzdef");
  });

  test("insertion (zero-width range)", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "abcdef" });
      ec.updateText(2, 2, "XY");
      return ec.text;
    });
    expect(result).toBe("abXYcdef");
  });

  test("deletion", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "abcdef" });
      ec.updateText(1, 3, "");
      return ec.text;
    });
    expect(result).toBe("adef");
  });

  test("rangeStart > rangeEnd: swapped silently", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "abcdef" });
      ec.updateText(3, 0, "xyz");
      return ec.text;
    });
    expect(result).toBe("xyzdef");
  });

  test("rangeEnd > text.length: clamped", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "abc" });
      ec.updateText(1, 100, "x");
      return ec.text;
    });
    expect(result).toBe("ax");
  });

  test("rangeStart > text.length: clamped to text.length", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "abc" });
      ec.updateText(100, 200, "xyz");
      return ec.text;
    });
    expect(result).toBe("abcxyz");
  });

  test("selection NOT adjusted: selection after update range stays put", async ({
    page,
    setContent,
  }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({
        text: "abcdef",
        selectionStart: 5,
        selectionEnd: 5,
      });
      ec.updateText(0, 2, "XYZ"); // "ab" → "XYZ", but selection stays
      return {
        text: ec.text,
        selectionStart: ec.selectionStart,
        selectionEnd: ec.selectionEnd,
      };
    });
    // Chrome's selection adjustment is behind a disabled feature flag,
    // so selection stays at its original position.
    expect(result).toEqual({
      text: "XYZcdef",
      selectionStart: 5,
      selectionEnd: 5,
    });
  });

  test("selection NOT adjusted: selection overlaps update range stays put", async ({
    page,
    setContent,
  }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({
        text: "abcdef",
        selectionStart: 1,
        selectionEnd: 4,
      });
      ec.updateText(2, 5, "X"); // overlap: sel[1,4] overlaps update[2,5]
      return {
        text: ec.text,
        selectionStart: ec.selectionStart,
        selectionEnd: ec.selectionEnd,
      };
    });
    // Selection is not adjusted — stays at original values.
    expect(result.text).toBe("abXf");
    expect(result.selectionStart).toBe(1);
    expect(result.selectionEnd).toBe(4);
  });

  test("selection NOT adjusted: selection before update range (no change)", async ({
    page,
    setContent,
  }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({
        text: "abcdef",
        selectionStart: 0,
        selectionEnd: 1,
      });
      ec.updateText(3, 5, "XY");
      return {
        selectionStart: ec.selectionStart,
        selectionEnd: ec.selectionEnd,
      };
    });
    expect(result.selectionStart).toBe(0);
    expect(result.selectionEnd).toBe(1);
  });

  test("does NOT fire textupdate event", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "abc" });
      let fired = false;
      ec.addEventListener("textupdate", () => {
        fired = true;
      });
      ec.updateText(0, 1, "X");
      return fired;
    });
    expect(result).toBe(false);
  });
});
