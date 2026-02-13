import { test, expect } from "../fixtures/test-base.js";

const HTML = `
  <div id="target"></div>
  <canvas id="canvas"></canvas>
  <input id="input" />
  <div id="other"></div>
`;

test.describe("EditContext element binding", () => {
  test("set editContext on valid element (div)", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext();
      el.editContext = ec;
      return el.editContext === ec;
    });
    expect(result).toBe(true);
  });

  test("set editContext on canvas", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const el = document.getElementById("canvas") as HTMLCanvasElement;
      const ec = new EditContext();
      el.editContext = ec;
      return el.editContext === ec;
    });
    expect(result).toBe(true);
  });

  test("set editContext on invalid element (input) throws NotSupportedError", async ({
    page,
    setContent,
  }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const el = document.getElementById("input") as HTMLInputElement;
      const ec = new EditContext();
      try {
        el.editContext = ec;
        return { threw: false, name: "" };
      } catch (e: unknown) {
        return { threw: true, name: (e as DOMException).name };
      }
    });
    expect(result.threw).toBe(true);
    expect(result.name).toBe("NotSupportedError");
  });

  test("set same editContext to two elements throws NotSupportedError", async ({
    page,
    setContent,
  }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const el1 = document.getElementById("target")!;
      const el2 = document.getElementById("other")!;
      const ec = new EditContext();
      el1.editContext = ec;
      try {
        el2.editContext = ec;
        return { threw: false };
      } catch (e: unknown) {
        return { threw: true, name: (e as DOMException).name };
      }
    });
    expect(result.threw).toBe(true);
    expect(result.name).toBe("NotSupportedError");
  });

  test("set null to detach", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext();
      el.editContext = ec;
      el.editContext = null;
      return el.editContext;
    });
    expect(result).toBeNull();
  });

  test("set editContext already on this element is a no-op", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext();
      el.editContext = ec;
      el.editContext = ec; // no-op, should not throw
      return el.editContext === ec;
    });
    expect(result).toBe(true);
  });

  test("attachedElements() returns [element] when bound", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext();
      el.editContext = ec;
      const attached = ec.attachedElements();
      return attached.length === 1 && attached[0] === el;
    });
    expect(result).toBe(true);
  });

  test("attachedElements() returns [] after detach", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext();
      el.editContext = ec;
      el.editContext = null;
      return ec.attachedElements().length;
    });
    expect(result).toBe(0);
  });

  test("detach from focused element during composition fires compositionend", async ({
    page,
    setContent,
  }, testInfo) => {
    // Polyfill-only: needs _setComposition to start composition
    test.skip(
      !testInfo.project.name.includes("polyfill"),
      "Composition internals only available on polyfill",
    );

    await setContent(HTML);
    const result = await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext();
      el.editContext = ec;
      el.focus();

      const events: string[] = [];
      ec.addEventListener("compositionend", ((e: CompositionEvent) =>
        events.push(`compositionend:${e.data}`)) as EventListener);

      ec._setComposition("ka", 2, 2);
      // Detach while composing
      el.editContext = null;

      return { text: ec.text, events };
    });
    // Composition text should be kept (finishComposingText on deactivation)
    expect(result.text).toBe("ka");
    expect(result.events.length).toBe(1);
    expect(result.events[0]).toMatch(/^compositionend:/);
  });
});
