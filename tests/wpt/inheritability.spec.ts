// Ported from WPT (Chromium's Web Platform Tests for EditContext)
// Source: editing/edit-context/edit-context-inheritability.tentative.html
// Tests editability inheritance through contenteditable and nested EditContext.
import { test, expect } from "../fixtures/test-base.js";

/** Wait for the polyfill's hidden textarea to be focused after clicking an
 *  EditContext element, then let the deferred setTimeout(0) sync settle. */
async function waitForEditContextFocus(
  page: import("@playwright/test").Page,
  selector: string,
): Promise<void> {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return false;
      if (el.shadowRoot) {
        const textarea = el.shadowRoot.querySelector("textarea");
        return textarea ? document.activeElement === textarea || el.shadowRoot.activeElement === textarea : false;
      }
      return document.activeElement === el;
    },
    selector,
    { timeout: 5000 },
  );
  // Let the mouse handler's deferred setTimeout(0) sync complete
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
}

test("element with EditContext is editable and gets events", async ({
  page,
  setContent,
}) => {
  await setContent('<div id="edit-context-top-0" style="min-height:20px"></div>');

  await page.evaluate(() => {
    const element = document.getElementById("edit-context-top-0")!;
    element.editContext = new EditContext();
    (window as Record<string, unknown>).__eventLog = [] as string[];
    element.addEventListener("beforeinput", (e) => {
      if (e.target === element)
        ((window as Record<string, unknown>).__eventLog as string[]).push(
          `beforeinput: ${element.id}`,
        );
    });
    element.editContext!.addEventListener("textupdate", () => {
      ((window as Record<string, unknown>).__eventLog as string[]).push(
        `textupdate: ${element.id}`,
      );
    });
  });

  await page.click("#edit-context-top-0");
  await waitForEditContextFocus(page, "#edit-context-top-0");
  await page.keyboard.type("a");

  const eventLog = await page.evaluate(
    () => (window as Record<string, unknown>).__eventLog,
  );
  expect(eventLog).toEqual([
    "beforeinput: edit-context-top-0",
    "textupdate: edit-context-top-0",
  ]);
});

test("child of EditContext is editable and parent EditContext gets events", async ({
  page,
  setContent,
}) => {
  await setContent(`
    <div id="edit-context-top-1">
      <div id="default-1">Click here to type</div>
    </div>
  `);

  await page.evaluate(() => {
    const parent = document.getElementById("edit-context-top-1")!;
    parent.editContext = new EditContext();
    (window as Record<string, unknown>).__eventLog = [] as string[];
    parent.addEventListener("beforeinput", (e) => {
      if (e.target === parent)
        ((window as Record<string, unknown>).__eventLog as string[]).push(
          `beforeinput: ${parent.id}`,
        );
    });
    parent.editContext!.addEventListener("textupdate", () => {
      ((window as Record<string, unknown>).__eventLog as string[]).push(
        `textupdate: ${parent.id}`,
      );
    });
  });

  await page.click("#default-1");
  await waitForEditContextFocus(page, "#edit-context-top-1");
  await page.keyboard.type("a");

  const eventLog = await page.evaluate(
    () => (window as Record<string, unknown>).__eventLog,
  );
  expect(eventLog).toEqual([
    "beforeinput: edit-context-top-1",
    "textupdate: edit-context-top-1",
  ]);
});

test("input element in EditContext gets its own events", async ({
  page,
  setContent,
}) => {
  await setContent(`
    <div id="edit-context-top-6">
      <input id="input-in-ec-6" value="">
    </div>
  `);

  await page.evaluate(() => {
    const parent = document.getElementById("edit-context-top-6")!;
    parent.editContext = new EditContext();
    const input = document.getElementById("input-in-ec-6")!;
    (window as Record<string, unknown>).__eventLog = [] as string[];
    input.addEventListener("beforeinput", (e) => {
      if (e.target === input)
        ((window as Record<string, unknown>).__eventLog as string[]).push(
          `beforeinput: ${input.id}`,
        );
    });
    input.addEventListener("input", (e) => {
      if (e.target === input)
        ((window as Record<string, unknown>).__eventLog as string[]).push(
          `input: ${input.id}`,
        );
    });
  });

  await page.click("#input-in-ec-6");
  await page.keyboard.type("a");

  const eventLog = await page.evaluate(
    () => (window as Record<string, unknown>).__eventLog,
  );
  expect(eventLog).toEqual([
    "beforeinput: input-in-ec-6",
    "input: input-in-ec-6",
  ]);
});

test("nested EditContext child of EditContext: parent gets events", async ({
  page,
  setContent,
}) => {
  await setContent(`
    <div id="edit-context-top-7">
      <div id="edit-context-in-ec-7">Click here</div>
    </div>
  `);

  await page.evaluate(() => {
    const parent = document.getElementById("edit-context-top-7")!;
    const child = document.getElementById("edit-context-in-ec-7")!;
    parent.editContext = new EditContext();
    child.editContext = new EditContext();
    (window as Record<string, unknown>).__eventLog = [] as string[];

    parent.addEventListener("beforeinput", (e) => {
      if (e.target === parent)
        ((window as Record<string, unknown>).__eventLog as string[]).push(
          `beforeinput: ${parent.id}`,
        );
    });
    parent.editContext!.addEventListener("textupdate", () => {
      ((window as Record<string, unknown>).__eventLog as string[]).push(
        `textupdate: ${parent.id}`,
      );
    });
    child.addEventListener("beforeinput", (e) => {
      if (e.target === child)
        ((window as Record<string, unknown>).__eventLog as string[]).push(
          `beforeinput: ${child.id}`,
        );
    });
    child.editContext!.addEventListener("textupdate", () => {
      ((window as Record<string, unknown>).__eventLog as string[]).push(
        `textupdate: ${child.id}`,
      );
    });
  });

  await page.click("#edit-context-in-ec-7");
  await waitForEditContextFocus(page, "#edit-context-top-7");
  await page.keyboard.type("a");

  const eventLog = await page.evaluate(
    () => (window as Record<string, unknown>).__eventLog,
  );
  // Parent EditContext gets the events, not the child
  expect(eventLog).toEqual([
    "beforeinput: edit-context-top-7",
    "textupdate: edit-context-top-7",
  ]);
});
