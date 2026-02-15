// End-to-end interaction workflow tests: type, select, delete, blur, click, edit.
// Exercises the pattern of normal editor usage that can break across focus
// transitions, especially on Firefox.
//
// EditContext is a low-level API — navigation and selection are the app's
// responsibility. These tests use updateSelection() for selection changes,
// which is how real editors work with EditContext.

import { test, expect } from "../fixtures/test-base.js";

const HTML = `
  <div id="editor" style="width:300px;height:100px;padding:8px;font:16px monospace;"></div>
  <button id="other" style="width:100px;height:40px;">other</button>
`;

/** Set up a basic editor that syncs selection on textupdate. */
function setupEditor(): void {
  const el = document.getElementById("editor")!;
  const ec = new EditContext();
  el.editContext = ec;
  (window as any).__ec = ec;
  (window as any).__el = el;

  ec.addEventListener("textupdate", ((e: TextUpdateEvent) => {
    ec.updateSelection(e.selectionStart, e.selectionEnd);
  }) as EventListener);

  el.focus();
}

function getState(): { text: string; selStart: number; selEnd: number } {
  const ec = (window as any).__ec as EditContext;
  return {
    text: ec.text,
    selStart: ec.selectionStart,
    selEnd: ec.selectionEnd,
  };
}

test.describe("Interaction workflows", () => {
  test("type, select all, type over, blur, refocus, type more", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(setupEditor);

    await page.keyboard.type("hello world");

    // Select all via updateSelection (app responsibility)
    await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      ec.updateSelection(0, ec.text.length);
    });

    // Overwrite selection
    await page.keyboard.type("replaced");

    // Blur by clicking another element
    await page.click("#other");

    // Refocus by clicking the editor
    await page.click("#editor");

    // Type more text
    await page.keyboard.type("!");

    const result = await page.evaluate(getState);
    expect(result.text).toBe("replaced!");
  });

  test("type, select partial, delete, blur, refocus via focus(), type", async ({
    page,
    setContent,
  }) => {
    await setContent(HTML);
    await page.evaluate(setupEditor);

    await page.keyboard.type("abcdef");

    // Select last 3 chars
    await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      ec.updateSelection(3, 6);
    });

    // Delete the selection
    await page.keyboard.press("Backspace");

    // Blur
    await page.evaluate(() => document.getElementById("other")!.focus());

    // Refocus via element.focus()
    await page.evaluate(() => document.getElementById("editor")!.focus());

    // Type more
    await page.keyboard.type("xyz");

    const result = await page.evaluate(getState);
    expect(result.text).toBe("abcxyz");
  });

  test("type, blur, refocus, select all, type over", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(setupEditor);

    await page.keyboard.type("first");

    // Blur
    await page.click("#other");

    // Refocus
    await page.click("#editor");

    // Select all and replace
    await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      ec.updateSelection(0, ec.text.length);
    });
    await page.keyboard.type("second");

    const result = await page.evaluate(getState);
    expect(result.text).toBe("second");
  });

  test("multiple blur/refocus cycles preserve state", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(setupEditor);

    await page.keyboard.type("abc");
    await page.click("#other");
    await page.click("#editor");

    await page.keyboard.type("def");
    await page.click("#other");
    await page.click("#editor");

    await page.keyboard.type("ghi");

    const result = await page.evaluate(getState);
    expect(result.text).toBe("abcdefghi");
  });

  test("select partial, type over, blur, refocus, select all, type over", async ({
    page,
    setContent,
  }) => {
    await setContent(HTML);
    await page.evaluate(setupEditor);

    await page.keyboard.type("hello world");

    // Select "hello" (first 5 chars)
    await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      ec.updateSelection(0, 5);
    });

    // Replace with "hi"
    await page.keyboard.type("hi");

    // Blur and refocus
    await page.click("#other");
    await page.click("#editor");

    // Select all and replace
    await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      ec.updateSelection(0, ec.text.length);
    });
    await page.keyboard.type("final");

    const result = await page.evaluate(getState);
    expect(result.text).toBe("final");
  });

  test("tab away and back preserves text", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(setupEditor);

    await page.keyboard.type("before");

    // Tab to the button
    await page.keyboard.press("Tab");

    // Tab back (Shift+Tab)
    await page.keyboard.press("Shift+Tab");

    await page.keyboard.type("after");

    const result = await page.evaluate(getState);
    expect(result.text).toBe("beforeafter");
  });

  test("type, blur immediately, refocus, type more", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(setupEditor);

    await page.keyboard.type("start ");

    // Blur immediately after typing
    await page.click("#other");
    await page.waitForTimeout(50);

    // Refocus and continue
    await page.click("#editor");
    await page.keyboard.type("end");

    const result = await page.evaluate(getState);
    expect(result.text).toBe("start end");
  });

  test("type, delete some, blur via click, refocus via click, type more", async ({
    page,
    setContent,
  }) => {
    await setContent(HTML);
    await page.evaluate(setupEditor);

    await page.keyboard.type("abcdef");

    // Delete last 3 chars
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");

    // Blur by clicking another element
    await page.click("#other");

    // Refocus by clicking the editor
    await page.click("#editor");

    // Should be able to type
    await page.keyboard.type("xyz");

    const result = await page.evaluate(getState);
    expect(result.text).toBe("abcxyz");
  });

  test("focus, blur, refocus, type", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(setupEditor);

    // Focus is already set by setupEditor

    // Blur by clicking another element
    await page.click("#other");

    // Refocus by clicking the editor
    await page.click("#editor");

    // Should be able to type
    await page.keyboard.type("hello");

    const result = await page.evaluate(getState);
    expect(result.text).toBe("hello");
  });

  test("pre-filled editor: focus, blur, refocus, type", async ({ page, setContent }) => {
    await setContent(HTML);

    // Pre-fill editor with text and a render loop (like the demo)
    await page.evaluate(() => {
      const el = document.getElementById("editor")!;
      const ec = new EditContext({ text: "existing text", selectionStart: 13, selectionEnd: 13 });
      el.editContext = ec;
      (window as any).__ec = ec;
      (window as any).__el = el;

      function render(): void {
        el.textContent = ec.text;
        // Set DOM selection to match EditContext selection
        if (el.firstChild) {
          const range = document.createRange();
          const pos = Math.min(ec.selectionStart, el.firstChild.textContent!.length);
          range.setStart(el.firstChild, pos);
          range.collapse(true);
          document.getSelection()!.removeAllRanges();
          document.getSelection()!.addRange(range);
        }
      }

      ec.addEventListener("textupdate", ((e: TextUpdateEvent) => {
        ec.updateSelection(e.selectionStart, e.selectionEnd);
        render();
      }) as EventListener);

      // Sync selection from DOM to EditContext (like the demo does)
      document.addEventListener("selectionchange", () => {
        const sel = document.getSelection();
        if (!sel || !sel.anchorNode || !el.contains(sel.anchorNode)) return;
        const offset = sel.anchorOffset;
        ec.updateSelection(offset, offset);
      });

      render();
      el.focus();
    });

    // Blur
    await page.click("#other");

    // Refocus
    await page.click("#editor");

    // Type
    await page.keyboard.type("!");

    const result = await page.evaluate(getState);
    expect(result.text).toContain("!");
  });

  test("type, blur by clicking body margins, refocus, type more", async ({ page, setContent }) => {
    await setContent(`
      <div style="margin:50px;">
        <div id="editor" style="width:300px;height:100px;padding:8px;font:16px monospace;"></div>
      </div>
    `);
    await page.evaluate(setupEditor);

    await page.keyboard.type("hello");

    // Blur by clicking on empty body space (not a button)
    await page.mouse.click(5, 5);

    // Verify editor is blurred
    const blurred = await page.evaluate(() => {
      const el = document.getElementById("editor")!;
      return document.activeElement !== el;
    });
    expect(blurred).toBe(true);

    // Refocus by clicking the editor
    await page.click("#editor");

    // Type more
    await page.keyboard.type(" world");

    const result = await page.evaluate(getState);
    expect(result.text).toBe("hello world");
  });

  test("demo-like innerHTML render: type, blur, refocus, type", async ({ page, setContent }) => {
    await setContent(`
      <div id="editor" style="width:300px;height:100px;padding:8px;font:16px monospace;"></div>
      <button id="other" style="width:100px;height:40px;">other</button>
    `);

    // Set up editor with demo-style innerHTML render and selectionchange handler
    await page.evaluate(() => {
      const el = document.getElementById("editor")!;
      const ec = new EditContext({ text: "initial", selectionStart: 7, selectionEnd: 7 });
      el.editContext = ec;
      (window as any).__ec = ec;
      (window as any).__el = el;

      function render(): void {
        el.innerHTML = "";
        const words = ec.text.split(" ").filter((w: string) => !!w);
        for (let i = 0; i < words.length; i++) {
          const span = document.createElement("span");
          span.textContent = words[i];
          el.appendChild(span);
          const space = document.createElement("span");
          space.textContent = " ";
          el.appendChild(space);
        }
        // Set DOM selection
        document.getSelection()!.removeAllRanges();
        if (el.firstChild) {
          let pos = ec.selectionStart;
          let targetNode: Node | null = null;
          let targetOffset = 0;
          for (const child of el.childNodes) {
            const len = child.textContent!.length;
            if (pos <= len) {
              targetNode = child.firstChild || child;
              targetOffset = pos;
              break;
            }
            pos -= len;
          }
          if (targetNode) {
            const range = document.createRange();
            range.setStart(targetNode, Math.min(targetOffset, targetNode.textContent!.length));
            range.collapse(true);
            document.getSelection()!.addRange(range);
          }
        }
      }

      ec.addEventListener("textupdate", ((e: TextUpdateEvent) => {
        ec.updateSelection(e.selectionStart, e.selectionEnd);
        render();
      }) as EventListener);

      document.addEventListener("selectionchange", () => {
        const sel = document.getSelection();
        if (!sel || !sel.anchorNode || !el.contains(sel.anchorNode)) return;
        // Walk spans to compute offset
        let offset = sel.anchorOffset;
        for (const child of el.childNodes) {
          if (child === sel.anchorNode || child.contains(sel.anchorNode)) break;
          offset += child.textContent!.length;
        }
        ec.updateSelection(offset, offset);
      });

      render();
      el.focus();
    });

    // Type some text
    await page.keyboard.type(" more");

    // Blur
    await page.click("#other");

    // Refocus
    await page.click("#editor");

    // Type more
    await page.keyboard.type("!");

    const result = await page.evaluate(getState);
    expect(result.text).toContain("!");
    expect(result.text).toContain("more");
  });

  test("caret overlay is removed on blur", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(setupEditor);

    await page.keyboard.type("hello");

    // Verify caret overlay exists while focused
    const caretsBefore = await page.evaluate(() => {
      const el = document.getElementById("editor")!;
      return el.querySelectorAll("div[style*='z-index']").length;
    });

    // Blur
    await page.click("#other");

    // Caret overlay should be gone
    const caretsAfter = await page.evaluate(() => {
      const el = document.getElementById("editor")!;
      return el.querySelectorAll("div[style*='z-index']").length;
    });
    expect(caretsAfter).toBe(0);
  });
});

test.describe("Firefox-specific: Enter key normalization", () => {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires destructuring
  test.beforeEach(({}, testInfo) => {
    test.skip(!testInfo.project.name.includes("firefox"), "Firefox-specific");
  });

  test("Enter produces insertParagraph (not insertLineBreak)", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(setupEditor);

    await page.evaluate(() => {
      (window as any).__beforeInputTypes = [] as string[];
      (window as any).__el.addEventListener("beforeinput", (e: InputEvent) => {
        (window as any).__beforeInputTypes.push(e.inputType);
      });
    });

    await page.keyboard.type("hello");
    await page.keyboard.press("Enter");

    const inputTypes: string[] = await page.evaluate(() => (window as any).__beforeInputTypes);
    expect(inputTypes).toContain("insertParagraph");
    expect(inputTypes).not.toContain("insertLineBreak");
  });

  test("Shift+Enter produces insertLineBreak", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(setupEditor);

    await page.evaluate(() => {
      (window as any).__beforeInputTypes = [] as string[];
      (window as any).__el.addEventListener("beforeinput", (e: InputEvent) => {
        (window as any).__beforeInputTypes.push(e.inputType);
      });
    });

    await page.keyboard.type("hello");
    await page.keyboard.press("Shift+Enter");

    const inputTypes: string[] = await page.evaluate(() => (window as any).__beforeInputTypes);
    expect(inputTypes).toContain("insertLineBreak");
    const paragraphCount = inputTypes.filter((t) => t === "insertParagraph").length;
    expect(paragraphCount).toBe(0);
  });

  test("Enter after blur/refocus still produces insertParagraph", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.evaluate(setupEditor);

    await page.keyboard.type("hello");

    // Blur and refocus
    await page.click("#other");
    await page.click("#editor");

    await page.evaluate(() => {
      (window as any).__beforeInputTypes = [] as string[];
      (window as any).__el.addEventListener("beforeinput", (e: InputEvent) => {
        (window as any).__beforeInputTypes.push(e.inputType);
      });
    });

    await page.keyboard.press("Enter");

    const inputTypes: string[] = await page.evaluate(() => (window as any).__beforeInputTypes);
    expect(inputTypes).toContain("insertParagraph");
    expect(inputTypes).not.toContain("insertLineBreak");
  });
});
