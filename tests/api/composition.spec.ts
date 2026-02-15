import { test, expect } from "../fixtures/test-base.js";

// Composition tests exercise the polyfill's internal composition state machine.
// We call _setComposition/_commitText/_cancelComposition/_finishComposingText
// directly because CDP Input.imeSetComposition crashes in headless Chromium.
// These only run on polyfill projects (native EditContext has no such methods).

const HTML = `<div id="target" style="width:200px;height:100px;"></div>`;

test.describe("EditContext composition", () => {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires destructuring
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !testInfo.project.name.includes("polyfill"),
      "Composition internals only available on polyfill",
    );
  });

  test("setComposition fires compositionstart on first non-empty text", async ({
    page,
    setContent,
  }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext();
      el.editContext = ec;
      el.focus();

      const events: string[] = [];
      ec.addEventListener("compositionstart", () => events.push("compositionstart"));
      ec.addEventListener("textupdate", () => events.push("textupdate"));

      ec._setComposition("k", 1, 1);
      return events;
    });
    expect(result).toContain("compositionstart");
    expect(result).toContain("textupdate");
  });

  test("setComposition updates text and fires textupdate", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext();
      const events: Array<{ text: string; start: number; end: number }> = [];
      ec.addEventListener("textupdate", ((e: TextUpdateEvent) => {
        events.push({
          text: e.text,
          start: e.updateRangeStart,
          end: e.updateRangeEnd,
        });
      }) as EventListener);

      ec._setComposition("k", 1, 1);
      ec._setComposition("ka", 2, 2);

      return {
        text: ec.text,
        selStart: ec.selectionStart,
        events,
      };
    });
    expect(result.text).toBe("ka");
    expect(result.selStart).toBe(2);
    expect(result.events.length).toBe(2);
    // Second update replaces the composition range (0-1) with "ka"
    expect(result.events[1].text).toBe("ka");
    expect(result.events[1].start).toBe(0);
    expect(result.events[1].end).toBe(1);
  });

  test("commitText fires textupdate + compositionend", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext();
      const events: string[] = [];
      ec.addEventListener("compositionstart", () => events.push("compositionstart"));
      ec.addEventListener("textupdate", () => events.push("textupdate"));
      ec.addEventListener("compositionend", ((e: CompositionEvent) =>
        events.push(`compositionend:${e.data}`)) as EventListener);

      ec._setComposition("k", 1, 1);
      ec._setComposition("ka", 2, 2);
      ec._commitText("か");

      return { text: ec.text, selStart: ec.selectionStart, events };
    });
    expect(result.text).toBe("か");
    expect(result.selStart).toBe(1);
    expect(result.events).toContain("compositionstart");
    expect(result.events).toContain("compositionend:か");
  });

  test("multi-step composition replaces correctly", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext();
      const texts: string[] = [];

      ec._setComposition("k", 1, 1);
      texts.push(ec.text);

      ec._setComposition("ka", 2, 2);
      texts.push(ec.text);

      ec._commitText("か");
      texts.push(ec.text);

      return texts;
    });
    expect(result).toEqual(["k", "ka", "か"]);
  });

  test("composition after existing text", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "hello", selectionStart: 5, selectionEnd: 5 });

      ec._setComposition("k", 1, 1);
      ec._setComposition("ka", 2, 2);
      ec._commitText("か");

      return { text: ec.text, selStart: ec.selectionStart };
    });
    expect(result.text).toBe("helloか");
    expect(result.selStart).toBe(6);
  });

  test("two sequential compositions", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext();
      const events: string[] = [];
      ec.addEventListener("compositionstart", () => events.push("compositionstart"));
      ec.addEventListener("compositionend", ((e: CompositionEvent) =>
        events.push(`compositionend:${e.data}`)) as EventListener);

      ec._setComposition("k", 1, 1);
      ec._commitText("か");

      ec._setComposition("n", 1, 1);
      ec._commitText("な");

      return { text: ec.text, events };
    });
    expect(result.text).toBe("かな");
    const starts = result.events.filter((e) => e === "compositionstart");
    const ends = result.events.filter((e) => e.startsWith("compositionend:"));
    expect(starts.length).toBe(2);
    expect(ends.length).toBe(2);
  });

  test("cancelComposition deletes composition text", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "hello", selectionStart: 5, selectionEnd: 5 });
      const events: string[] = [];
      ec.addEventListener("textupdate", ((e: TextUpdateEvent) =>
        events.push(`textupdate:${e.text}`)) as EventListener);
      ec.addEventListener("compositionend", ((e: CompositionEvent) =>
        events.push(`compositionend:${e.data}`)) as EventListener);

      ec._setComposition("ka", 2, 2);
      ec._cancelComposition();

      return { text: ec.text, selStart: ec.selectionStart, events };
    });
    expect(result.text).toBe("hello");
    expect(result.selStart).toBe(5);
    // Should have textupdate with empty text (deletion) and compositionend with ""
    expect(result.events).toContain("textupdate:");
    expect(result.events).toContain("compositionend:");
  });

  test("finishComposingText keeps text and fires compositionend", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext();
      const events: string[] = [];
      ec.addEventListener("compositionend", ((e: CompositionEvent) =>
        events.push(`compositionend:${e.data}`)) as EventListener);

      ec._setComposition("ka", 2, 2);
      ec._finishComposingText(true); // keepSelection

      return { text: ec.text, selStart: ec.selectionStart, events };
    });
    expect(result.text).toBe("ka");
    expect(result.events).toContain("compositionend:ka");
  });

  test("blur during composition fires compositionend", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext();
      const events: string[] = [];
      ec.addEventListener("compositionend", ((e: CompositionEvent) =>
        events.push(`compositionend:${e.data}`)) as EventListener);

      ec._setComposition("ka", 2, 2);
      ec._blur(); // FinishComposingText(keepSelection=true)

      return { text: ec.text, events };
    });
    expect(result.text).toBe("ka");
    const compositionEndEvents = result.events.filter((e) => e.startsWith("compositionend:"));
    expect(compositionEndEvents.length).toBe(1);
  });

  test("setComposition with empty text cancels composition", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "hello", selectionStart: 5, selectionEnd: 5 });
      const events: string[] = [];
      ec.addEventListener("compositionend", ((e: CompositionEvent) =>
        events.push(`compositionend:${e.data}`)) as EventListener);

      ec._setComposition("ka", 2, 2);
      ec._setComposition("", 0, 0); // empty = cancel

      return { text: ec.text, events };
    });
    expect(result.text).toBe("hello");
    expect(result.events).toContain("compositionend:");
  });

  test("updateSelection during composition cancels it", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "hello", selectionStart: 5, selectionEnd: 5 });
      const events: string[] = [];
      ec.addEventListener("compositionend", ((e: CompositionEvent) =>
        events.push(`compositionend:${e.data}`)) as EventListener);

      ec._setComposition("ka", 2, 2);
      // Change selection — should cancel composition
      ec.updateSelection(0, 0);

      return { text: ec.text, events, selStart: ec.selectionStart };
    });
    // Composition text "ka" should be removed
    expect(result.text).toBe("hello");
    expect(result.selStart).toBe(0);
    expect(result.events).toContain("compositionend:");
  });

  test("isComposing reflects composition state", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext();
      const states: boolean[] = [];

      states.push(ec.isComposing); // false
      ec._setComposition("k", 1, 1);
      states.push(ec.isComposing); // true
      ec._commitText("か");
      states.push(ec.isComposing); // false

      return states;
    });
    expect(result).toEqual([false, true, false]);
  });

  test("updateSelection then immediate composition uses correct position", async ({
    page,
    setContent,
  }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "hello world", selectionStart: 11, selectionEnd: 11 });

      // Move cursor to position 5 (between "hello" and " world")
      ec.updateSelection(5, 5);

      // Immediately start composing
      ec._setComposition("x", 1, 1);
      ec._commitText("X");

      return { text: ec.text, selStart: ec.selectionStart };
    });
    // "X" should be inserted at position 5, not at the end
    expect(result.text).toBe("helloX world");
    expect(result.selStart).toBe(6);
  });

  test("textformatupdate fires during composition with default format", async ({
    page,
    setContent,
  }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "hello", selectionStart: 5, selectionEnd: 5 });
      const formats: Array<{
        rangeStart: number;
        rangeEnd: number;
        underlineStyle: string;
        underlineThickness: string;
      }> = [];

      ec.addEventListener("textformatupdate", ((e: any) => {
        for (const f of e.getTextFormats()) {
          formats.push({
            rangeStart: f.rangeStart,
            rangeEnd: f.rangeEnd,
            underlineStyle: f.underlineStyle,
            underlineThickness: f.underlineThickness,
          });
        }
      }) as EventListener);

      ec._setComposition("ka", 2, 2);
      ec._setComposition("kan", 3, 3);

      return { formats, text: ec.text };
    });
    expect(result.text).toBe("hellokan");
    // Two textformatupdate events (one per setComposition)
    expect(result.formats.length).toBe(2);
    // First: composition range [5, 7] for "ka"
    expect(result.formats[0]).toEqual({
      rangeStart: 5,
      rangeEnd: 7,
      underlineStyle: "solid",
      underlineThickness: "thin",
    });
    // Second: composition range [5, 8] for "kan"
    expect(result.formats[1]).toEqual({
      rangeStart: 5,
      rangeEnd: 8,
      underlineStyle: "solid",
      underlineThickness: "thin",
    });
  });

  test("characterboundsupdate fires during composition", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "hello", selectionStart: 5, selectionEnd: 5 });
      const updates: Array<{ rangeStart: number; rangeEnd: number }> = [];

      ec.addEventListener("characterboundsupdate", ((e: any) => {
        updates.push({ rangeStart: e.rangeStart, rangeEnd: e.rangeEnd });
      }) as EventListener);

      ec._setComposition("ka", 2, 2);
      ec._commitText("か");

      return { updates };
    });
    // characterboundsupdate fires during setComposition, not commitText
    expect(result.updates.length).toBe(1);
    expect(result.updates[0]).toEqual({ rangeStart: 5, rangeEnd: 7 });
  });

  test("textformatupdate does not fire after commitText or cancelComposition", async ({
    page,
    setContent,
  }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext();
      let formatCount = 0;
      ec.addEventListener("textformatupdate", () => formatCount++);

      // Compose and commit
      ec._setComposition("k", 1, 1);
      const afterCompose = formatCount;
      ec._commitText("か");
      const afterCommit = formatCount;

      // Compose and cancel
      ec._setComposition("n", 1, 1);
      const afterCompose2 = formatCount;
      ec._cancelComposition();
      const afterCancel = formatCount;

      return { afterCompose, afterCommit, afterCompose2, afterCancel };
    });
    expect(result.afterCompose).toBe(1);
    expect(result.afterCommit).toBe(1); // no extra after commit
    expect(result.afterCompose2).toBe(2);
    expect(result.afterCancel).toBe(2); // no extra after cancel
  });

  test("compositionstart/end fire on EditContext, NOT on element", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const el = document.getElementById("target")!;
      const ec = new EditContext();
      el.editContext = ec;
      el.focus();

      const ecEvents: string[] = [];
      const elEvents: string[] = [];

      ec.addEventListener("compositionstart", () => ecEvents.push("compositionstart"));
      ec.addEventListener("compositionend", () => ecEvents.push("compositionend"));
      el.addEventListener("compositionstart", () => elEvents.push("compositionstart"));
      el.addEventListener("compositionend", () => elEvents.push("compositionend"));

      ec._setComposition("k", 1, 1);
      ec._commitText("か");

      return { ecEvents, elEvents };
    });
    expect(result.ecEvents).toContain("compositionstart");
    expect(result.ecEvents).toContain("compositionend");
    expect(result.elEvents).toEqual([]);
  });
});
