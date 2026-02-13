// Ported from WPT (Chromium's Web Platform Tests for EditContext)
// Source: editing/edit-context/edit-context-focus.tentative.html
import { test, expect } from "../fixtures/test-base.js";

test("EditContext deactivates when focus moves away recursively", async ({
  page,
  setContent,
}) => {
  await setContent(`
    <div id="edit-context-element"></div>
    <input id="other-input" value="">
  `);

  const result = await page.evaluate(() => {
    const editContextElement = document.getElementById(
      "edit-context-element",
    )!;
    const otherInput = document.getElementById("other-input") as HTMLInputElement;
    const editContext = new EditContext();
    editContextElement.editContext = editContext;
    editContextElement.focus();

    let textupdateCount = 0;
    editContext.addEventListener("textupdate", () => {
      textupdateCount++;
    });

    return new Promise<{ textupdateCount: number }>((resolve) => {
      // Move focus to the other input
      otherInput.focus();
      setTimeout(() => {
        resolve({ textupdateCount });
      }, 100);
    });
  });

  // After focus moves away, typing should go to the other input, not the EditContext
  await page.keyboard.type("a");

  const afterType = await page.evaluate(() => {
    const otherInput = document.getElementById("other-input") as HTMLInputElement;
    const editContextElement = document.getElementById(
      "edit-context-element",
    )!;
    return {
      inputValue: otherInput.value,
      editContextText: editContextElement.editContext!.text,
    };
  });

  expect(afterType.inputValue).toBe("a");
  expect(afterType.editContextText).toBe("");
});
