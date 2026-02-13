// Ported from WPT (Chromium's Web Platform Tests for EditContext)
// Source: editing/edit-context/edit-context-property.tentative.html
import { test, expect } from "../fixtures/test-base.js";
import {
  HTML5_SHADOW_ALLOWED_ELEMENTS,
  HTML5_SHADOW_DISALLOWED_ELEMENTS,
} from "../fixtures/wpt-constants.js";

test("HTMLElement.prototype.editContext exists", async ({
  page,
  setContent,
}) => {
  await setContent("<div>test</div>");

  const result = await page.evaluate(() => {
    return {
      inPrototype: "editContext" in HTMLElement.prototype,
      divType: typeof document.createElement("div").editContext,
    };
  });

  expect(result.inPrototype).toBe(true);
  expect(result.divType).toBe("object");
});

test("editContext is not on Node, Element, or other non-HTMLElement prototypes", async ({
  page,
  setContent,
}) => {
  await setContent("<div>test</div>");

  const result = await page.evaluate(() => {
    return {
      notOnNode: !("editContext" in Node.prototype),
      notOnElement: !("editContext" in Element.prototype),
      notOnCharacterData: !("editContext" in CharacterData.prototype),
      notOnComment: !("editContext" in Comment.prototype),
      commentUndefined:
        typeof document.createComment("").editContext === "undefined",
      notOnDocument: !("editContext" in Document.prototype),
      documentUndefined: typeof document.editContext === "undefined",
      notOnDocumentFragment: !("editContext" in DocumentFragment.prototype),
      notOnText: !("editContext" in Text.prototype),
      textNodeUndefined:
        typeof document.createTextNode("").editContext === "undefined",
    };
  });

  expect(result.notOnNode).toBe(true);
  expect(result.notOnElement).toBe(true);
  expect(result.notOnCharacterData).toBe(true);
  expect(result.notOnComment).toBe(true);
  expect(result.commentUndefined).toBe(true);
  expect(result.notOnDocument).toBe(true);
  expect(result.documentUndefined).toBe(true);
  expect(result.notOnDocumentFragment).toBe(true);
  expect(result.notOnText).toBe(true);
  expect(result.textNodeUndefined).toBe(true);
});

test("editContext throws TypeError for invalid values", async ({
  page,
  setContent,
}) => {
  await setContent("<div>test</div>");

  const result = await page.evaluate(() => {
    const errors: string[] = [];

    try {
      (document.createElement("div") as Record<string, unknown>).editContext =
        "hello";
      errors.push("should throw for string");
    } catch (e) {
      if (!(e instanceof TypeError)) errors.push("string: not TypeError");
    }

    try {
      (document.createElement("div") as Record<string, unknown>).editContext =
        42;
      errors.push("should throw for number");
    } catch (e) {
      if (!(e instanceof TypeError)) errors.push("number: not TypeError");
    }

    try {
      (document.createElement("div") as Record<string, unknown>).editContext =
        document.createElement("span");
      errors.push("should throw for node");
    } catch (e) {
      if (!(e instanceof TypeError)) errors.push("node: not TypeError");
    }

    return errors;
  });

  expect(result).toEqual([]);
});

test("editContext can be set on shadow-allowed elements plus canvas", async ({
  page,
  setContent,
}) => {
  await setContent("<div>test</div>");
  const allowedElements = [...HTML5_SHADOW_ALLOWED_ELEMENTS, "canvas"];

  const result = await page.evaluate((elements) => {
    const errors: string[] = [];
    for (const tagName of elements) {
      const element = document.createElement(tagName);
      const ec = new EditContext();
      try {
        element.editContext = ec;
        if (element.editContext !== ec) {
          errors.push(`${tagName}: getter did not return same instance`);
        }
        // Clean up for next iteration
        element.editContext = null;
      } catch (e) {
        errors.push(`${tagName}: threw ${(e as Error).message}`);
      }
    }
    return errors;
  }, allowedElements);

  expect(result).toEqual([]);
});

test("editContext throws NotSupportedError for disallowed elements", async ({
  page,
  setContent,
}) => {
  await setContent("<div>test</div>");
  // EditContext disallowed = shadow disallowed minus canvas
  const disallowedElements = HTML5_SHADOW_DISALLOWED_ELEMENTS.filter(
    (el) => el !== "canvas",
  );

  const result = await page.evaluate((elements) => {
    const errors: string[] = [];
    for (const tagName of elements) {
      const element = document.createElement(tagName);
      const ec = new EditContext();
      try {
        element.editContext = ec;
        errors.push(`${tagName}: should have thrown`);
      } catch (e) {
        if (!(e instanceof DOMException) || e.name !== "NotSupportedError") {
          errors.push(
            `${tagName}: expected NotSupportedError, got ${(e as Error).constructor.name}: ${(e as Error).message}`,
          );
        }
      }
      if (element.editContext !== null) {
        errors.push(`${tagName}: editContext should be null after throw`);
      }
    }
    return errors;
  }, disallowedElements);

  expect(result).toEqual([]);
});

test("an EditContext can only be associated with one element at a time", async ({
  page,
  setContent,
}) => {
  await setContent("<div>test</div>");

  const result = await page.evaluate(() => {
    const element1 = document.createElement("div");
    const element2 = document.createElement("div");
    const editContext1 = new EditContext();
    const editContext2 = new EditContext();

    element1.editContext = editContext1;

    // Trying to set editContext1 on element2 should throw
    let threwNotSupported = false;
    try {
      element2.editContext = editContext1;
    } catch (e) {
      threwNotSupported =
        e instanceof DOMException && e.name === "NotSupportedError";
    }

    const element1StillHasEc1 = element1.editContext === editContext1;
    const element2StillNull = element2.editContext === null;

    // Switching element1 to a different EditContext should work
    element1.editContext = editContext2;
    const switchedToEc2 = element1.editContext === editContext2;

    // Assigning the same EditContext again is a no-op
    element1.editContext = editContext2;
    const sameAgain = element1.editContext === editContext2;

    return {
      threwNotSupported,
      element1StillHasEc1,
      element2StillNull,
      switchedToEc2,
      sameAgain,
    };
  });

  expect(result.threwNotSupported).toBe(true);
  expect(result.element1StillHasEc1).toBe(true);
  expect(result.element2StillNull).toBe(true);
  expect(result.switchedToEc2).toBe(true);
  expect(result.sameAgain).toBe(true);
});
