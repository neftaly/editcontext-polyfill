// Ported from WPT (Chromium's Web Platform Tests for EditContext)
// Source: editing/edit-context/edit-context-input.tentative.html
import { test, expect } from "../fixtures/test-base.js";

const BACKSPACE_KEY = "Backspace";
const DELETE_KEY = "Delete";

for (const tagName of ["div", "canvas"]) {
  test(`basic text input with ${tagName}`, async ({
    page,
    setContent,
  }) => {
    await setContent(`<${tagName} id="target"></${tagName}>`);

    // biome-ignore lint/correctness/noUnusedFunctionParameters: WPT port
    const result = await page.evaluate((tag) => {
      const element = document.getElementById("target")!;
      const editContext = new EditContext();
      let textForView = "";
      let beforeInputType: string | null = null;

      element.addEventListener("beforeinput", (e: Event) => {
        const inputEvent = e as InputEvent;
        beforeInputType = inputEvent.inputType;
      });

      editContext.addEventListener("textupdate", (e: Event) => {
        const textUpdate = e as TextUpdateEvent;
        textForView = `${textForView.substring(0, textUpdate.updateRangeStart)}${textUpdate.text}${textForView.substring(textUpdate.updateRangeEnd)}`;
      });

      element.editContext = editContext;
      element.focus();

      return new Promise<{
        text: string;
        textForView: string;
        beforeInputType: string | null;
      }>((resolve) => {
        // Wait a frame for focus to settle
        requestAnimationFrame(() => {
          resolve({
            text: editContext.text,
            textForView,
            beforeInputType,
          });
        });
      });
    }, tagName);

    // Type a character using keyboard
    await page.keyboard.type("a");

    // Wait for events to process
    const after = await page.evaluate(() => {
      const element = document.getElementById("target")!;
      const editContext = element.editContext!;
      return {
        text: editContext.text,
        innerHTML: element.innerHTML,
      };
    });

    expect(after.text).toBe("a");
    // Shadow DOM hides the textarea from innerHTML for div.
    // Canvas can't have shadow DOM, so the polyfill's hidden textarea
    // appears as a direct child — but it should still be invisible.
    if (tagName === "canvas") {
      // On polyfill, innerHTML may contain the hidden textarea element.
      // Verify no visible text nodes were added to the DOM.
      const hasTextNode = await page.evaluate(() => {
        const el = document.getElementById("target")!;
        return Array.from(el.childNodes).some(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== "",
        );
      });
      expect(hasTextNode).toBe(false);
    } else {
      expect(after.innerHTML).toBe("");
    }
  });
}

test("text insertion with non-collapsed selection with div", async ({
  page,
  setContent,
}) => {
  await setContent('<div id="target"></div>');

  await page.evaluate(() => {
    const element = document.getElementById("target")!;
    const editContext = new EditContext();
    element.editContext = editContext;
    element.focus();

    editContext.updateText(0, 0, "abcd");
    editContext.updateSelection(2, 3);
  });

  await page.keyboard.type("Z");

  const result = await page.evaluate(() => {
    const element = document.getElementById("target")!;
    return element.editContext!.text;
  });

  expect(result).toBe("abZd");
});

test("text insertion with backwards selection", async ({
  page,
  setContent,
}) => {
  await setContent('<div id="target"></div>');

  await page.evaluate(() => {
    const element = document.getElementById("target")!;
    const editContext = new EditContext();
    element.editContext = editContext;
    element.focus();

    editContext.updateText(0, 0, "abcd");
    editContext.updateSelection(3, 1);
  });

  await page.keyboard.type("Y");

  const result = await page.evaluate(() => {
    const element = document.getElementById("target")!;
    return element.editContext!.text;
  });

  expect(result).toBe("aYd");
});

test("EditContext should disable DOM mutation", async ({
  page,
  setContent,
}) => {
  await setContent('<div id="target"></div>');

  await page.evaluate(() => {
    const element = document.getElementById("target")!;
    const editContext = new EditContext();
    element.editContext = editContext;
    element.focus();
  });

  await page.keyboard.type("a");

  const result = await page.evaluate(() => {
    const element = document.getElementById("target")!;
    return {
      innerHTML: element.innerHTML,
      text: element.editContext!.text,
    };
  });

  expect(result.innerHTML).toBe("");
  expect(result.text).toBe("a");
});

test("beforeInput(insertText) should be cancelable", async ({
  page,
  setContent,
}) => {
  await setContent('<div id="target"></div>');

  await page.evaluate(() => {
    const element = document.getElementById("target")!;
    const editContext = new EditContext();
    element.editContext = editContext;

    element.addEventListener("beforeinput", (e: Event) => {
      const inputEvent = e as InputEvent;
      if (inputEvent.inputType === "insertText") {
        e.preventDefault();
      }
    });

    element.focus();
  });

  await page.keyboard.type("a");

  const result = await page.evaluate(() => {
    const element = document.getElementById("target")!;
    return element.editContext!.text;
  });

  expect(result).toBe("");
});

test("EditContext should not receive events after being detached", async ({
  page,
  setContent,
}) => {
  await setContent('<div id="target">Hello World</div>');

  await page.evaluate(() => {
    const element = document.getElementById("target")!;
    const editContext = new EditContext();
    element.editContext = editContext;
    element.focus();

    (window as Record<string, unknown>).__gotTextupdate = false;
    (window as Record<string, unknown>).__gotBeforeinput = false;

    element.addEventListener("beforeinput", () => {
      (window as Record<string, unknown>).__gotBeforeinput = true;
    });
    editContext.addEventListener("textupdate", () => {
      (window as Record<string, unknown>).__gotTextupdate = true;
    });

    // Detach
    element.editContext = null;
  });

  await page.keyboard.type("a");

  const result = await page.evaluate(() => {
    return {
      gotTextupdate: (window as Record<string, unknown>).__gotTextupdate,
      gotBeforeinput: (window as Record<string, unknown>).__gotBeforeinput,
    };
  });

  expect(result.gotTextupdate).toBe(false);
  expect(result.gotBeforeinput).toBe(false);
});

for (const tagName of ["div", "canvas"]) {
  test(`backspace and delete in EditContext with ${tagName}`, async ({
    page,
    setContent,
  }) => {
    await setContent(`<${tagName} id="target"></${tagName}>`);

    await page.evaluate(() => {
      const element = document.getElementById("target")!;
      const editContext = new EditContext();

      (window as Record<string, unknown>).__textForView = "hello there";
      (window as Record<string, unknown>).__beforeInputType = null;
      (window as Record<string, unknown>).__textUpdateSelection = null;

      element.addEventListener("beforeinput", (e: Event) => {
        (window as Record<string, unknown>).__beforeInputType = (
          e as InputEvent
        ).inputType;
      });

      editContext.addEventListener("textupdate", (e: Event) => {
        const textUpdate = e as TextUpdateEvent;
        (window as Record<string, unknown>).__textUpdateSelection = [
          textUpdate.selectionStart,
          textUpdate.selectionEnd,
        ];
        const textForView = (window as Record<string, unknown>)
          .__textForView as string;
        (window as Record<string, unknown>).__textForView =
          `${textForView.substring(0, textUpdate.updateRangeStart)}${textUpdate.text}${textForView.substring(textUpdate.updateRangeEnd)}`;
      });

      element.editContext = editContext;
      editContext.updateText(0, 11, "hello there");
      editContext.updateSelection(10, 10);
      element.focus();
    });

    // Backspace
    await page.keyboard.press(BACKSPACE_KEY);

    const afterBackspace = await page.evaluate(() => ({
      textForView: (window as Record<string, unknown>).__textForView,
      textUpdateSelection: (window as Record<string, unknown>)
        .__textUpdateSelection,
      beforeInputType: (window as Record<string, unknown>).__beforeInputType,
    }));

    expect(afterBackspace.textForView).toBe("hello thee");
    expect(afterBackspace.textUpdateSelection).toEqual([9, 9]);
    expect(afterBackspace.beforeInputType).toBe("deleteContentBackward");

    // Delete
    await page.keyboard.press(DELETE_KEY);

    const afterDelete = await page.evaluate(() => ({
      textForView: (window as Record<string, unknown>).__textForView,
      textUpdateSelection: (window as Record<string, unknown>)
        .__textUpdateSelection,
      beforeInputType: (window as Record<string, unknown>).__beforeInputType,
    }));

    expect(afterDelete.textForView).toBe("hello the");
    expect(afterDelete.textUpdateSelection).toEqual([9, 9]);
    expect(afterDelete.beforeInputType).toBe("deleteContentForward");
  });
}

for (const tagName of ["div", "canvas"]) {
  test(`backspace and delete with existing selection with ${tagName}`, async ({
    page,
    setContent,
  }) => {
    await setContent(`<${tagName} id="target"></${tagName}>`);

    await page.evaluate(() => {
      const element = document.getElementById("target")!;
      const editContext = new EditContext();

      const initialText = "abcdefghijklmnopqrstuvwxyz";
      (window as Record<string, unknown>).__textForView = initialText;

      editContext.addEventListener("textupdate", (e: Event) => {
        const tu = e as TextUpdateEvent;
        const textForView = (window as Record<string, unknown>)
          .__textForView as string;
        (window as Record<string, unknown>).__textForView =
          `${textForView.substring(0, tu.updateRangeStart)}${tu.text}${textForView.substring(tu.updateRangeEnd)}`;
      });

      element.editContext = editContext;
      editContext.updateText(0, initialText.length, initialText);
      element.focus();
    });

    // Forward selection [3,6), backspace
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      el.editContext!.updateSelection(3, 6);
    });
    await page.keyboard.press(BACKSPACE_KEY);

    let text = await page.evaluate(() => ({
      text: (window as Record<string, unknown>).__textForView,
      ecText: document.getElementById("target")!.editContext!.text,
    }));
    expect(text.text).toBe("abcghijklmnopqrstuvwxyz");
    expect(text.ecText).toBe("abcghijklmnopqrstuvwxyz");

    // Forward selection [3,6), delete
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      el.editContext!.updateSelection(3, 6);
    });
    await page.keyboard.press(DELETE_KEY);

    text = await page.evaluate(() => ({
      text: (window as Record<string, unknown>).__textForView,
      ecText: document.getElementById("target")!.editContext!.text,
    }));
    expect(text.text).toBe("abcjklmnopqrstuvwxyz");
    expect(text.ecText).toBe("abcjklmnopqrstuvwxyz");

    // Backwards selection [6,3), backspace
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      el.editContext!.updateSelection(6, 3);
    });
    await page.keyboard.press(BACKSPACE_KEY);

    text = await page.evaluate(() => ({
      text: (window as Record<string, unknown>).__textForView,
      ecText: document.getElementById("target")!.editContext!.text,
    }));
    expect(text.text).toBe("abcmnopqrstuvwxyz");
    expect(text.ecText).toBe("abcmnopqrstuvwxyz");

    // Backwards selection [6,3), delete
    await page.evaluate(() => {
      const el = document.getElementById("target")!;
      el.editContext!.updateSelection(6, 3);
    });
    await page.keyboard.press(DELETE_KEY);

    text = await page.evaluate(() => ({
      text: (window as Record<string, unknown>).__textForView,
      ecText: document.getElementById("target")!.editContext!.text,
    }));
    expect(text.text).toBe("abcpqrstuvwxyz");
    expect(text.ecText).toBe("abcpqrstuvwxyz");
  });
}
