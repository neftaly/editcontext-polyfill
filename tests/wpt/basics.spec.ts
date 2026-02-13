// Ported from WPT (Chromium's Web Platform Tests for EditContext)
// Source: editing/edit-context/edit-context-basics.tentative.html
import { test, expect } from "../fixtures/test-base.js";

test("EditContext can be created", async ({ page, setContent }) => {
  await setContent("<div>test</div>");

  const result = await page.evaluate(() => {
    const editContext = new EditContext();
    return {
      exists: editContext !== null,
      isEventTarget: editContext instanceof EventTarget,
    };
  });

  expect(result.exists).toBe(true);
  expect(result.isEventTarget).toBe(true);
});

test("EditContext default state", async ({ page, setContent }) => {
  await setContent("<div>test</div>");

  const result = await page.evaluate(() => {
    const editContext = new EditContext();
    return {
      text: editContext.text,
      selectionStart: editContext.selectionStart,
      selectionEnd: editContext.selectionEnd,
      characterBoundsRangeStart: editContext.characterBoundsRangeStart,
    };
  });

  expect(result.text).toBe("");
  expect(result.selectionStart).toBe(0);
  expect(result.selectionEnd).toBe(0);
  expect(result.characterBoundsRangeStart).toBe(0);
});

test("EditContext with initial text", async ({ page, setContent }) => {
  await setContent("<div>test</div>");

  const result = await page.evaluate(() => {
    const editContext = new EditContext({ text: "foo" });
    return {
      text: editContext.text,
      selectionStart: editContext.selectionStart,
      selectionEnd: editContext.selectionEnd,
    };
  });

  expect(result.text).toBe("foo");
  expect(result.selectionStart).toBe(0);
  expect(result.selectionEnd).toBe(0);
});

test("EditContext with initial selection", async ({ page, setContent }) => {
  await setContent("<div>test</div>");

  const result = await page.evaluate(() => {
    const editContext = new EditContext({
      text: "foo",
      selectionStart: 0,
      selectionEnd: 3,
    });
    return {
      text: editContext.text,
      selectionStart: editContext.selectionStart,
      selectionEnd: editContext.selectionEnd,
    };
  });

  expect(result.text).toBe("foo");
  expect(result.selectionStart).toBe(0);
  expect(result.selectionEnd).toBe(3);
});

test("updateText replaces range", async ({ page, setContent }) => {
  await setContent("<div>test</div>");

  const result = await page.evaluate(() => {
    const ec = new EditContext();
    ec.updateText(0, 0, "abcdef");

    ec.updateText(2, 5, "ghi");
    const after1 = ec.text; // "abghif"

    ec.updateText(5, 2, "jkl");
    const after2 = ec.text; // "abjklf" (backwards range swaps)

    return { after1, after2 };
  });

  expect(result.after1).toBe("abghif");
  expect(result.after2).toBe("abjklf");
});

test("updateSelection sets selection", async ({ page, setContent }) => {
  await setContent("<div>test</div>");

  const result = await page.evaluate(() => {
    const editContext = new EditContext({ text: "Hello" });
    editContext.updateSelection(1, 3);
    return {
      selectionStart: editContext.selectionStart,
      selectionEnd: editContext.selectionEnd,
    };
  });

  expect(result.selectionStart).toBe(1);
  expect(result.selectionEnd).toBe(3);
});

test("updateSelection allows backwards selection (start > end)", async ({
  page,
  setContent,
}) => {
  await setContent("<div>test</div>");

  const result = await page.evaluate(() => {
    const editContext = new EditContext({ text: "Hello" });
    editContext.updateSelection(3, 1);
    return {
      selectionStart: editContext.selectionStart,
      selectionEnd: editContext.selectionEnd,
    };
  });

  expect(result.selectionStart).toBe(3);
  expect(result.selectionEnd).toBe(1);
});

test("updateCharacterBounds and characterBounds()", async ({
  page,
  setContent,
}) => {
  await setContent("<div>test</div>");

  const result = await page.evaluate(() => {
    const editContext = new EditContext({ text: "Hello" });
    const bounds = [
      new DOMRect(0, 0, 10, 20),
      new DOMRect(10, 0, 10, 20),
      new DOMRect(20, 0, 10, 20),
    ];
    editContext.updateCharacterBounds(1, bounds);
    const retrievedBounds = editContext.characterBounds();
    return {
      rangeStart: editContext.characterBoundsRangeStart,
      count: retrievedBounds.length,
      firstX: retrievedBounds[0].x,
      secondX: retrievedBounds[1].x,
      thirdX: retrievedBounds[2].x,
    };
  });

  expect(result.rangeStart).toBe(1);
  expect(result.count).toBe(3);
  expect(result.firstX).toBe(0);
  expect(result.secondX).toBe(10);
  expect(result.thirdX).toBe(20);
});

test("attachedElements() is empty when not associated", async ({
  page,
  setContent,
}) => {
  await setContent("<div>test</div>");

  const result = await page.evaluate(() => {
    const editContext = new EditContext();
    return editContext.attachedElements().length;
  });

  expect(result).toBe(0);
});

test("attachedElements() returns the associated element", async ({
  page,
  setContent,
}) => {
  await setContent('<div id="target">test</div>');

  const result = await page.evaluate(() => {
    const editContext = new EditContext();
    const div = document.getElementById("target")!;
    div.editContext = editContext;
    const elements = editContext.attachedElements();
    return {
      count: elements.length,
      isCorrectElement: elements[0] === div,
    };
  });

  expect(result.count).toBe(1);
  expect(result.isCorrectElement).toBe(true);
});

test("event handler attributes can be set and fired", async ({
  page,
  setContent,
}) => {
  await setContent("<div>test</div>");

  const result = await page.evaluate(() => {
    const editContext = new EditContext();
    const events: string[] = [];

    editContext.ontextupdate = () => events.push("textupdate");
    editContext.ontextformatupdate = () => events.push("textformatupdate");
    editContext.oncharacterboundsupdate = () =>
      events.push("characterboundsupdate");
    editContext.oncompositionstart = () => events.push("compositionstart");
    editContext.oncompositionend = () => events.push("compositionend");

    editContext.dispatchEvent(new Event("textupdate"));
    editContext.dispatchEvent(new Event("textformatupdate"));
    editContext.dispatchEvent(new Event("characterboundsupdate"));
    editContext.dispatchEvent(new Event("compositionstart"));
    editContext.dispatchEvent(new Event("compositionend"));

    return events;
  });

  expect(result).toEqual([
    "textupdate",
    "textformatupdate",
    "characterboundsupdate",
    "compositionstart",
    "compositionend",
  ]);
});
