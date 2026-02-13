import { test, expect } from "../fixtures/test-base.js";

const HTML = `<div id="target" style="width:200px;height:100px;"></div>`;

test.describe("EditContext delete operations", () => {
  test("backspace with collapsed selection: deletes one grapheme", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext({
        text: "abcdef",
        selectionStart: 3,
        selectionEnd: 3,
      });
      el.editContext = ec;
      el.focus();
      (window as any).__ec = ec;
    });

    await page.keyboard.press("Backspace");

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return { text: ec.text, selStart: ec.selectionStart };
    });
    expect(result.text).toBe("abdef");
    expect(result.selStart).toBe(2);
  });

  test("backspace with range selection: deletes selection", async ({ page, setContent }) => {
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

    await page.keyboard.press("Backspace");

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return { text: ec.text, selStart: ec.selectionStart };
    });
    expect(result.text).toBe("aef");
    expect(result.selStart).toBe(1);
  });

  test("backspace at start of text: no-op", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext({
        text: "abc",
        selectionStart: 0,
        selectionEnd: 0,
      });
      el.editContext = ec;
      el.focus();
      (window as any).__ec = ec;
    });

    await page.keyboard.press("Backspace");

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return { text: ec.text, selStart: ec.selectionStart };
    });
    expect(result.text).toBe("abc");
    expect(result.selStart).toBe(0);
  });

  test("delete with collapsed selection: deletes one grapheme forward", async ({
    page,
    setContent,
  }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext({
        text: "abcdef",
        selectionStart: 2,
        selectionEnd: 2,
      });
      el.editContext = ec;
      el.focus();
      (window as any).__ec = ec;
    });

    await page.keyboard.press("Delete");

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return { text: ec.text, selStart: ec.selectionStart };
    });
    expect(result.text).toBe("abdef");
    expect(result.selStart).toBe(2);
  });

  test("delete with range selection: deletes selection", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext({
        text: "abcdef",
        selectionStart: 2,
        selectionEnd: 5,
      });
      el.editContext = ec;
      el.focus();
      (window as any).__ec = ec;
    });

    await page.keyboard.press("Delete");

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return { text: ec.text, selStart: ec.selectionStart };
    });
    expect(result.text).toBe("abf");
    expect(result.selStart).toBe(2);
  });

  test("delete at end of text: no-op", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext({
        text: "abc",
        selectionStart: 3,
        selectionEnd: 3,
      });
      el.editContext = ec;
      el.focus();
      (window as any).__ec = ec;
    });

    await page.keyboard.press("Delete");

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return { text: ec.text, selStart: ec.selectionStart };
    });
    expect(result.text).toBe("abc");
    expect(result.selStart).toBe(3);
  });

  test("ctrl+backspace: deletes word backward", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext({
        text: "hello world",
        selectionStart: 5,
        selectionEnd: 5,
      });
      el.editContext = ec;
      el.focus();
      (window as any).__ec = ec;
    });

    await page.keyboard.press("Control+Backspace");

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return { text: ec.text, selStart: ec.selectionStart };
    });
    expect(result.text).toBe(" world");
    expect(result.selStart).toBe(0);
  });

  test("ctrl+delete: deletes word forward", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext({
        text: "hello world",
        selectionStart: 6,
        selectionEnd: 6,
      });
      el.editContext = ec;
      el.focus();
      (window as any).__ec = ec;
    });

    await page.keyboard.press("Control+Delete");

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return { text: ec.text, selStart: ec.selectionStart };
    });
    expect(result.text).toBe("hello ");
    expect(result.selStart).toBe(6);
  });

  test("backspace fires textupdate with empty text", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext({
        text: "abcdef",
        selectionStart: 3,
        selectionEnd: 3,
      });
      el.editContext = ec;
      el.focus();
      (window as any).__ec = ec;
      ec.addEventListener("textupdate", ((e: TextUpdateEvent) => {
        (window as any).__lastTextUpdate = {
          text: e.text,
          updateRangeStart: e.updateRangeStart,
          updateRangeEnd: e.updateRangeEnd,
        };
      }) as EventListener);
    });

    await page.keyboard.press("Backspace");

    const result = await page.evaluate(() => (window as any).__lastTextUpdate);
    expect(result).toEqual({
      text: "",
      updateRangeStart: 2,
      updateRangeEnd: 3,
    });
  });

  test("backspace over emoji deletes whole cluster", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const text = "a\u{1F600}b"; // "a😀b" — emoji is 2 UTF-16 code units
      const ec = new EditContext({
        text,
        selectionStart: 3, // after the emoji
        selectionEnd: 3,
      });
      el.editContext = ec;
      el.focus();
      (window as any).__ec = ec;
    });

    await page.keyboard.press("Backspace");

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return { text: ec.text };
    });
    expect(result.text).toBe("ab");
  });
});
