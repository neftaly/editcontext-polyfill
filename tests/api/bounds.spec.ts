import { test, expect } from "../fixtures/test-base.js";

const HTML = `<div id="target"></div>`;

test.describe("EditContext bounds", () => {
  test("updateCharacterBounds stores array and rangeStart", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "hello" });
      const bounds = [
        new DOMRect(0, 0, 10, 20),
        new DOMRect(10, 0, 10, 20),
        new DOMRect(20, 0, 10, 20),
      ];
      ec.updateCharacterBounds(2, bounds);
      const stored = ec.characterBounds();
      return {
        rangeStart: ec.characterBoundsRangeStart,
        length: stored.length,
        first: { x: stored[0].x, width: stored[0].width },
        second: { x: stored[1].x, width: stored[1].width },
        third: { x: stored[2].x, width: stored[2].width },
      };
    });
    expect(result.rangeStart).toBe(2);
    expect(result.length).toBe(3);
    expect(result.first).toEqual({ x: 0, width: 10 });
    expect(result.second).toEqual({ x: 10, width: 10 });
    expect(result.third).toEqual({ x: 20, width: 10 });
  });

  test("characterBounds() returns copies (not references)", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "ab" });
      ec.updateCharacterBounds(0, [new DOMRect(0, 0, 10, 20)]);
      const a = ec.characterBounds();
      const b = ec.characterBounds();
      return a[0] !== b[0]; // different object references
    });
    expect(result).toBe(true);
  });

  test("updateCharacterBounds overwrites previous", async ({ page, setContent }) => {
    await setContent(HTML);
    const result = await page.evaluate(() => {
      const ec = new EditContext({ text: "hello" });
      ec.updateCharacterBounds(0, [new DOMRect(0, 0, 5, 5)]);
      ec.updateCharacterBounds(1, [new DOMRect(99, 99, 99, 99)]);
      const stored = ec.characterBounds();
      return {
        rangeStart: ec.characterBoundsRangeStart,
        length: stored.length,
        x: stored[0].x,
      };
    });
    expect(result.rangeStart).toBe(1);
    expect(result.length).toBe(1);
    expect(result.x).toBe(99);
  });
});
