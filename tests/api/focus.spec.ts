import { test, expect } from "../fixtures/test-base.js";

const HTML = `
  <div id="a" style="width:100px;height:50px;"></div>
  <div id="b" style="width:100px;height:50px;"></div>
  <div id="plain" tabindex="0" style="width:100px;height:50px;"></div>
`;

test.describe("EditContext focus/activation", () => {
  test("focus element makes editContext active (typing works)", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("a")!;
      const ec = new EditContext();
      el.editContext = ec;
      el.focus();
      (window as any).__ec = ec;
    });

    await page.keyboard.type("hi");

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return { text: ec.text };
    });
    expect(result.text).toBe("hi");
  });

  test("blur element stops input", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("a")!;
      const ec = new EditContext();
      el.editContext = ec;
      el.focus();
      (window as any).__ec = ec;
    });

    await page.keyboard.type("ab");

    // Blur by focusing a non-editContext element
    await page.evaluate(() => {
      document.getElementById("plain")!.focus();
    });

    await page.keyboard.type("cd");

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return { text: ec.text };
    });
    // "cd" should NOT have been captured
    expect(result.text).toBe("ab");
  });

  test("focus element A then focus element B: A deactivated, B activated", async ({
    page,
    setContent,
  }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const elA = document.getElementById("a")!;
      const ecA = new EditContext();
      elA.editContext = ecA;

      const elB = document.getElementById("b")!;
      const ecB = new EditContext();
      elB.editContext = ecB;

      (window as any).__ecA = ecA;
      (window as any).__ecB = ecB;

      elA.focus();
    });

    await page.keyboard.type("A");

    await page.evaluate(() => {
      document.getElementById("b")!.focus();
    });

    await page.keyboard.type("B");

    const result = await page.evaluate(() => {
      return {
        textA: ((window as any).__ecA as EditContext).text,
        textB: ((window as any).__ecB as EditContext).text,
      };
    });
    expect(result.textA).toBe("A");
    expect(result.textB).toBe("B");
  });

  test("detach editContext from focused element stops input", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("a")!;
      const ec = new EditContext();
      el.editContext = ec;
      el.focus();
      (window as any).__ec = ec;
    });

    await page.keyboard.type("ab");

    await page.evaluate(() => {
      document.getElementById("a")!.editContext = null;
    });

    await page.keyboard.type("cd");

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return { text: ec.text };
    });
    expect(result.text).toBe("ab");
  });

  test("blur then refocus: typing resumes", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("a")!;
      const ec = new EditContext();
      el.editContext = ec;
      el.focus();
      (window as any).__ec = ec;
    });

    await page.keyboard.type("ab");

    // Blur by focusing another element
    await page.evaluate(() => {
      document.getElementById("plain")!.focus();
    });

    // Re-focus via element.focus()
    await page.evaluate(() => {
      document.getElementById("a")!.focus();
    });

    await page.keyboard.type("cd");

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return { text: ec.text };
    });
    expect(result.text).toBe("abcd");
  });

  test("blur then click to refocus: typing resumes", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("a")!;
      const ec = new EditContext();
      el.editContext = ec;
      el.focus();
      (window as any).__ec = ec;
    });

    await page.keyboard.type("ab");

    // Blur by clicking another element
    await page.click("#plain");

    // Refocus by clicking the EditContext element
    await page.click("#a");

    await page.keyboard.type("cd");

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return { text: ec.text };
    });
    expect(result.text).toBe("abcd");
  });

  test("tab away deactivates", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(() => {
      const el = document.getElementById("a")!;
      const ec = new EditContext();
      el.editContext = ec;
      // Make the plain div focusable after a
      document.getElementById("plain")!.tabIndex = 0;
      el.focus();
      (window as any).__ec = ec;
    });

    await page.keyboard.type("ab");
    await page.keyboard.press("Tab");
    await page.keyboard.type("cd");

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return { text: ec.text };
    });
    // After Tab, focus moves away — "cd" should not be captured
    expect(result.text).toBe("ab");
  });
});
