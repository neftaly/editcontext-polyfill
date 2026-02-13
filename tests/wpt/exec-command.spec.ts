// Ported from WPT (Chromium's Web Platform Tests for EditContext)
// Source: editing/edit-context/edit-context-execCommand.tentative.https.html
import { test, expect } from "../fixtures/test-base.js";

test("execCommand inserttext is suppressed in EditContext", async ({
  page,
  setContent,
}) => {
  await setContent('<div id="target"></div>');

  const result = await page.evaluate(() => {
    const element = document.getElementById("target")!;
    const editContext = new EditContext();
    element.editContext = editContext;
    element.focus();

    const success = document.execCommand("inserttext", false, "hello");
    return {
      success,
      innerHTML: element.innerHTML,
      editContextText: editContext.text,
    };
  });

  expect(result.success).toBe(false);
  expect(result.innerHTML).toBe("");
});

test("execCommand bold is suppressed in EditContext", async ({
  page,
  setContent,
}) => {
  await setContent('<div id="target">some text</div>');

  const result = await page.evaluate(() => {
    const element = document.getElementById("target")!;
    const editContext = new EditContext();
    element.editContext = editContext;
    element.focus();

    const success = document.execCommand("bold");
    return {
      success,
      innerHTML: element.innerHTML,
    };
  });

  expect(result.success).toBe(false);
  expect(result.innerHTML).toBe("some text");
});

test("execCommand copy is allowed in EditContext", async ({
  page,
  setContent,
}) => {
  // This test needs HTTPS context for clipboard access.
  // The WPT test expects copy to work; we test that it doesn't throw.
  await setContent('<div id="target">some text</div>');

  const result = await page.evaluate(() => {
    const element = document.getElementById("target")!;
    const editContext = new EditContext();
    element.editContext = editContext;
    element.focus();

    let threw = false;
    try {
      document.execCommand("copy");
    } catch {
      threw = true;
    }
    return { threw };
  });

  expect(result.threw).toBe(false);
});

test("execCommand cut does not mutate DOM in EditContext", async ({
  page,
  setContent,
}) => {
  await setContent('<div id="target">some text</div>');

  const result = await page.evaluate(() => {
    const element = document.getElementById("target")!;
    const editContext = new EditContext();
    element.editContext = editContext;
    element.focus();

    document.execCommand("cut");
    return {
      innerHTML: element.innerHTML,
    };
  });

  // Cut should not modify the DOM when EditContext is active
  expect(result.innerHTML).toBe("some text");
});
