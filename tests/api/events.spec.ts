import { test, expect } from "../fixtures/test-base.js";

const HTML = `<div id="target" style="width:200px;height:100px;"></div>`;

test.describe("EditContext events", () => {
  test("textupdate event has all required properties", async ({ page, setContent }) => {
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
        (window as any).__evt = {
          type: e.type,
          text: e.text,
          updateRangeStart: e.updateRangeStart,
          updateRangeEnd: e.updateRangeEnd,
          selectionStart: e.selectionStart,
          selectionEnd: e.selectionEnd,
          hasText: "text" in e,
          hasUpdateRangeStart: "updateRangeStart" in e,
          hasUpdateRangeEnd: "updateRangeEnd" in e,
          hasSelectionStart: "selectionStart" in e,
          hasSelectionEnd: "selectionEnd" in e,
        };
      }) as EventListener);
    });

    await page.keyboard.type("X");

    const result = await page.evaluate(() => (window as any).__evt);
    expect(result.type).toBe("textupdate");
    expect(result.text).toBe("X");
    expect(result.updateRangeStart).toBe(2);
    expect(result.updateRangeEnd).toBe(4);
    expect(result.selectionStart).toBe(3);
    expect(result.selectionEnd).toBe(3);
    expect(result.hasText).toBe(true);
    expect(result.hasUpdateRangeStart).toBe(true);
    expect(result.hasUpdateRangeEnd).toBe(true);
    expect(result.hasSelectionStart).toBe(true);
    expect(result.hasSelectionEnd).toBe(true);
  });

  test("event order for single char: keydown → beforeinput → textupdate → keyup", async ({
    page,
    setContent,
  }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext();
      el.editContext = ec;
      el.focus();
      (window as any).__log = [] as string[];
      const log = (window as any).__log;

      el.addEventListener("keydown", () => log.push("keydown"));
      el.addEventListener("beforeinput", () => log.push("beforeinput"));
      ec.addEventListener("textupdate", () => log.push("textupdate"));
      el.addEventListener("keyup", () => log.push("keyup"));
    });

    await page.keyboard.type("a");

    const log = await page.evaluate(() => (window as any).__log);
    expect(log).toEqual(["keydown", "beforeinput", "textupdate", "keyup"]);
  });

  test("event order for backspace: keydown → beforeinput → textupdate → keyup", async ({
    page,
    setContent,
  }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext({ text: "abc", selectionStart: 2, selectionEnd: 2 });
      el.editContext = ec;
      el.focus();
      (window as any).__log = [] as string[];
      const log = (window as any).__log;

      el.addEventListener("keydown", () => log.push("keydown"));
      el.addEventListener("beforeinput", () => log.push("beforeinput"));
      ec.addEventListener("textupdate", () => log.push("textupdate"));
      el.addEventListener("keyup", () => log.push("keyup"));
    });

    await page.keyboard.press("Backspace");

    const log = await page.evaluate(() => (window as any).__log);
    expect(log).toEqual(["keydown", "beforeinput", "textupdate", "keyup"]);
  });

  test("beforeinput fires on element with correct inputType for insertText", async ({
    page,
    setContent,
  }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext();
      el.editContext = ec;
      el.focus();
      (window as any).__inputType = "";
      el.addEventListener("beforeinput", ((e: InputEvent) => {
        (window as any).__inputType = e.inputType;
      }) as EventListener);
    });

    await page.keyboard.type("a");

    const inputType = await page.evaluate(() => (window as any).__inputType);
    expect(inputType).toBe("insertText");
  });

  test("beforeinput fires on element with correct inputType for deleteContentBackward", async ({
    page,
    setContent,
  }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext({ text: "abc", selectionStart: 2, selectionEnd: 2 });
      el.editContext = ec;
      el.focus();
      (window as any).__inputType = "";
      el.addEventListener("beforeinput", ((e: InputEvent) => {
        (window as any).__inputType = e.inputType;
      }) as EventListener);
    });

    await page.keyboard.press("Backspace");

    const inputType = await page.evaluate(() => (window as any).__inputType);
    expect(inputType).toBe("deleteContentBackward");
  });

  test("ontextupdate handler property works", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext();
      el.editContext = ec;
      el.focus();
      (window as any).__fired = false;
      ec.ontextupdate = () => {
        (window as any).__fired = true;
      };
    });

    await page.keyboard.type("a");

    const fired = await page.evaluate(() => (window as any).__fired);
    expect(fired).toBe(true);
  });

  test("setting ontextupdate to null removes handler", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext();
      ec.ontextupdate = () => {};
      ec.ontextupdate = null;
      return ec.ontextupdate;
    });
    expect(result).toBeNull();
  });

  test("input event does NOT fire on element when EditContext is active", async ({
    page,
    setContent,
  }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext();
      el.editContext = ec;
      el.focus();
      (window as any).__inputFired = false;
      el.addEventListener("input", () => {
        (window as any).__inputFired = true;
      });
    });

    await page.keyboard.type("abc");

    const fired = await page.evaluate(() => (window as any).__inputFired);
    expect(fired).toBe(false);
  });

  test("beforeinput for non-handled type (Enter/insertParagraph) fires but no textupdate", async ({
    page,
    setContent,
  }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext({ text: "abc", selectionStart: 3, selectionEnd: 3 });
      el.editContext = ec;
      el.focus();
      (window as any).__log = [] as string[];
      const log = (window as any).__log;

      el.addEventListener("beforeinput", ((e: InputEvent) => {
        log.push(`beforeinput:${e.inputType}`);
      }) as EventListener);
      ec.addEventListener("textupdate", () => log.push("textupdate"));
    });

    await page.keyboard.press("Enter");

    const result = await page.evaluate(() => {
      return {
        log: (window as any).__log as string[],
        text: ((window as any).__ec as EditContext)?.text,
      };
    });
    // beforeinput should fire with insertParagraph, but no textupdate
    expect(result.log).toContain("beforeinput:insertParagraph");
    expect(result.log).not.toContain("textupdate");
  });
});
