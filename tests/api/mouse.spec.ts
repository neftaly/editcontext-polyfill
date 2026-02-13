import { test, expect } from "../fixtures/test-base.js";

// A simple editor that renders per-character spans and tracks selectionchange.
// Each character is a <span data-idx="N"> so we can click at known positions.
const HTML = `
<div id="editor" style="font-family:monospace;font-size:16px;line-height:20px;padding:8px;width:400px;height:100px;"></div>
<script>
  const editor = document.getElementById("editor");
  const INIT = "Hello world";
  const ec = new EditContext({ text: INIT, selectionStart: INIT.length, selectionEnd: INIT.length });
  editor.editContext = ec;

  window.__ec = ec;
  window.__selChanges = [];

  function render() {
    editor.innerHTML = "";
    for (let i = 0; i < ec.text.length; i++) {
      const span = document.createElement("span");
      span.dataset.idx = String(i);
      span.textContent = ec.text[i];
      editor.appendChild(span);
    }
    // Restore selection in DOM
    if (editor.firstChild) {
      const sel = document.getSelection();
      sel.removeAllRanges();
      const start = Math.min(ec.selectionStart, ec.text.length);
      const end = Math.min(ec.selectionEnd, ec.text.length);
      const range = document.createRange();
      if (start === end) {
        // Collapsed: place caret
        const node = editor.childNodes[Math.min(start, editor.childNodes.length - 1)];
        if (node) {
          range.setStart(node.firstChild || node, start === editor.childNodes.length ? (node.firstChild || node).textContent.length : 0);
          range.collapse(true);
        }
      } else {
        const startNode = editor.childNodes[start];
        const endNode = editor.childNodes[Math.min(end - 1, editor.childNodes.length - 1)];
        if (startNode && endNode) {
          range.setStart(startNode.firstChild || startNode, 0);
          range.setEnd(endNode.firstChild || endNode, (endNode.firstChild || endNode).textContent.length);
        }
      }
      sel.addRange(range);
    }
  }

  ec.addEventListener("textupdate", (e) => {
    ec.updateSelection(e.selectionStart, e.selectionEnd);
    render();
  });

  // Track selection changes from mouse interaction
  document.addEventListener("selectionchange", () => {
    const sel = document.getSelection();
    if (!sel.anchorNode || !editor.contains(sel.anchorNode)) return;

    let start = 0, end = 0, foundStart = false, foundEnd = false;
    for (const span of editor.childNodes) {
      if (span.firstChild === sel.anchorNode || span === sel.anchorNode) { foundStart = true; start += sel.anchorOffset; }
      if (!foundStart) start += span.textContent.length;
      if (span.firstChild === sel.focusNode || span === sel.focusNode) { foundEnd = true; end += sel.focusOffset; }
      if (!foundEnd) end += span.textContent.length;
    }

    if (foundStart && foundEnd) {
      const sorted = [start, end].sort((a, b) => a - b);
      ec.updateSelection(sorted[0], sorted[1]);
      window.__selChanges.push({ start: sorted[0], end: sorted[1] });
    }
  });

  render();
  editor.focus();
</script>
`;

/** Get the center of a character span by data-idx. */
async function charCenter(page: import("@playwright/test").Page, idx: number) {
  return page.evaluate((i) => {
    const span = document.querySelector(`[data-idx="${i}"]`);
    if (!span) throw new Error(`No span for idx ${i}`);
    const r = span.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, idx);
}

test.describe("Mouse interactions", () => {
  test("click positions cursor via selectionchange", async ({ page, setContent }) => {
    await setContent(HTML);
    // Wait for render
    await page.waitForSelector("[data-idx='0']");

    // Click on character 5 ("w" in "world")
    // Note: "Hello world" — idx 5 is space, idx 6 is "w"
    const pos = await charCenter(page, 6);
    await page.mouse.click(pos.x, pos.y);

    // Wait for selectionchange to propagate
    await page.waitForTimeout(100);

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return {
        selStart: ec.selectionStart,
        selEnd: ec.selectionEnd,
        selChanges: (window as any).__selChanges,
      };
    });

    // selectionchange should have fired
    expect(result.selChanges.length).toBeGreaterThan(0);
    // Cursor should be near character 6 (exact position depends on click location)
    const lastChange = result.selChanges[result.selChanges.length - 1];
    expect(lastChange.start).toBe(lastChange.end); // Collapsed (cursor, not selection)
  });

  test("click then type inserts at clicked position", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.waitForSelector("[data-idx='0']");

    // Click at character 5 (space between "Hello" and "world")
    const pos = await charCenter(page, 5);
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(100);

    // Type a character
    await page.keyboard.type("X");

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return { text: ec.text };
    });

    // "X" should be inserted near position 5, not at end
    expect(result.text).toContain("X");
    expect(result.text).not.toBe("Hello worldX");
  });

  // Drag tests only work with the polyfill (which manually creates DOM selections
  // via caretRangeFromPoint). Native Chrome's drag selection is handled at a
  // lower level than Playwright's synthetic mouse events can trigger.
  test("drag selection selects a range", async ({ page, setContent }, testInfo) => {
    test.skip(!testInfo.project.name.includes("polyfill"), "requires polyfill mouse handler");
    await setContent(HTML);
    await page.waitForSelector("[data-idx='0']");

    // Drag from character 0 to character 4 ("Hello")
    const start = await charCenter(page, 0);
    const end = await charCenter(page, 4);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return {
        selStart: ec.selectionStart,
        selEnd: ec.selectionEnd,
      };
    });

    // Should have a non-collapsed selection
    expect(result.selEnd - result.selStart).toBeGreaterThan(0);
  });

  test("type over drag selection replaces text", async ({ page, setContent }, testInfo) => {
    test.skip(!testInfo.project.name.includes("polyfill"), "requires polyfill mouse handler");
    await setContent(HTML);
    await page.waitForSelector("[data-idx='0']");

    // Drag-select "Hello" (chars 0-4)
    const start = await charCenter(page, 0);
    const end = await charCenter(page, 4);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up();

    // Wait for the selection to sync and the deferred textarea re-sync
    await page.waitForFunction(
      () => {
        const ec = (window as any).__ec as EditContext;
        return ec.selectionStart !== ec.selectionEnd;
      },
      null,
      { timeout: 2000 },
    );
    // Allow the deferred setTimeout(0) sync to fire
    await page.waitForTimeout(50);

    // Type replacement
    await page.keyboard.type("Hi");

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return { text: ec.text };
    });

    // "Hello" should be replaced (partially or fully) with "Hi"
    expect(result.text).toContain("Hi");
    expect(result.text.length).toBeLessThan("Hello world".length);
  });

  test("double-click selects a word", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.waitForSelector("[data-idx='0']");

    // Double-click on character 1 (inside "Hello")
    const pos = await charCenter(page, 1);
    await page.mouse.dblclick(pos.x, pos.y);
    await page.waitForTimeout(100);

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return {
        selStart: ec.selectionStart,
        selEnd: ec.selectionEnd,
      };
    });

    // Should select the word "Hello" (positions 0-5) or at least a multi-char range
    expect(result.selEnd - result.selStart).toBeGreaterThan(1);
  });

  test("triple-click selects all content", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.waitForSelector("[data-idx='0']");

    // Triple-click
    const pos = await charCenter(page, 3);
    await page.mouse.click(pos.x, pos.y, { clickCount: 3 });
    await page.waitForTimeout(100);

    const result = await page.evaluate(() => {
      const ec = (window as any).__ec as EditContext;
      return {
        selStart: ec.selectionStart,
        selEnd: ec.selectionEnd,
        textLen: ec.text.length,
      };
    });

    // Should select all text
    expect(result.selStart).toBe(0);
    expect(result.selEnd).toBe(result.textLen);
  });

  test("click activates unfocused element", async ({ page, setContent }) => {
    await setContent(HTML);
    await page.waitForSelector("[data-idx='0']");

    // Blur the editor first
    await page.evaluate(() => {
      const editor = document.getElementById("editor")!;
      editor.blur();
    });

    // Click on character 3
    const pos = await charCenter(page, 3);
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(100);

    const result = await page.evaluate(() => {
      return {
        activeElement: document.activeElement?.id,
      };
    });

    expect(result.activeElement).toBe("editor");
  });
});
