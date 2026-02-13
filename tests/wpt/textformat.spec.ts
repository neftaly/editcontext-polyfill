// Ported from WPT (Chromium's Web Platform Tests for EditContext)
// Source: editing/edit-context/edit-context-textformat.tentative.html
import { test, expect } from "../fixtures/test-base.js";

test("default values of TextFormat attributes", async ({
  page,
  setContent,
}) => {
  await setContent("<div>test</div>");

  const result = await page.evaluate(() => {
    const textFormat = new TextFormat();
    return {
      rangeStart: textFormat.rangeStart,
      rangeEnd: textFormat.rangeEnd,
      underlineStyle: textFormat.underlineStyle,
      underlineThickness: textFormat.underlineThickness,
    };
  });

  expect(result.rangeStart).toBe(0);
  expect(result.rangeEnd).toBe(0);
  expect(result.underlineStyle).toBe("none");
  expect(result.underlineThickness).toBe("none");
});

test("valid and invalid values of TextFormat underlineStyle and underlineThickness", async ({
  page,
  setContent,
}) => {
  await setContent("<div>test</div>");

  const result = await page.evaluate(() => {
    const validUnderlineStyles = [
      "none",
      "solid",
      "dotted",
      "dashed",
      "wavy",
    ];
    const validUnderlineThicknesses = ["none", "thin", "thick"];
    const errors: string[] = [];
    const styleResults: { style: string; thickness: string }[] = [];
    const thicknessResults: { style: string; thickness: string }[] = [];

    // Invalid values should throw TypeError
    try {
      new TextFormat({ underlineStyle: "Solid" as never });
      errors.push("Should have thrown for underlineStyle 'Solid'");
    } catch (e) {
      if (!(e instanceof TypeError)) {
        errors.push(
          `Expected TypeError for underlineStyle 'Solid', got ${(e as Error).constructor.name}`,
        );
      }
    }

    try {
      new TextFormat({ underlineThickness: "Thick" as never });
      errors.push("Should have thrown for underlineThickness 'Thick'");
    } catch (e) {
      if (!(e instanceof TypeError)) {
        errors.push(
          `Expected TypeError for underlineThickness 'Thick', got ${(e as Error).constructor.name}`,
        );
      }
    }

    // Valid values
    for (const style of validUnderlineStyles) {
      const tf = new TextFormat({ underlineStyle: style as never });
      styleResults.push({
        style: tf.underlineStyle,
        thickness: tf.underlineThickness,
      });
    }

    for (const thickness of validUnderlineThicknesses) {
      const tf = new TextFormat({ underlineThickness: thickness as never });
      thicknessResults.push({
        style: tf.underlineStyle,
        thickness: tf.underlineThickness,
      });
    }

    return { errors, styleResults, thicknessResults };
  });

  expect(result.errors).toEqual([]);

  const validStyles = ["none", "solid", "dotted", "dashed", "wavy"];
  for (let i = 0; i < validStyles.length; i++) {
    expect(result.styleResults[i].style).toBe(validStyles[i]);
    expect(result.styleResults[i].thickness).toBe("none");
  }

  const validThicknesses = ["none", "thin", "thick"];
  for (let i = 0; i < validThicknesses.length; i++) {
    expect(result.thicknessResults[i].style).toBe("none");
    expect(result.thicknessResults[i].thickness).toBe(validThicknesses[i]);
  }
});
