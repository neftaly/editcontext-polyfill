// TextUpdateEvent — fired when the text content needs updating
export interface TextUpdateEventInit extends EventInit {
  updateRangeStart?: number;
  updateRangeEnd?: number;
  text?: string;
  selectionStart?: number;
  selectionEnd?: number;
  compositionStart?: number;
  compositionEnd?: number;
}

export class TextUpdateEventPolyfill extends Event {
  readonly updateRangeStart: number;
  readonly updateRangeEnd: number;
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly compositionStart: number;
  readonly compositionEnd: number;

  constructor(type: string, init: TextUpdateEventInit = {}) {
    super(type, init);
    this.updateRangeStart = init.updateRangeStart ?? 0;
    this.updateRangeEnd = init.updateRangeEnd ?? 0;
    this.text = init.text ?? "";
    this.selectionStart = init.selectionStart ?? 0;
    this.selectionEnd = init.selectionEnd ?? 0;
    this.compositionStart = init.compositionStart ?? 0;
    this.compositionEnd = init.compositionEnd ?? 0;
  }
}

// TextFormat — describes formatting applied during IME composition
export interface TextFormatInit {
  rangeStart?: number;
  rangeEnd?: number;
  underlineStyle?: UnderlineStyle;
  underlineThickness?: UnderlineThickness;
}

export type UnderlineStyle = "none" | "solid" | "dotted" | "dashed" | "wavy";
export type UnderlineThickness = "none" | "thin" | "thick";

const VALID_UNDERLINE_STYLES: ReadonlySet<string> = new Set([
  "none",
  "solid",
  "dotted",
  "dashed",
  "wavy",
]);
const VALID_UNDERLINE_THICKNESSES: ReadonlySet<string> = new Set(["none", "thin", "thick"]);

export class TextFormatPolyfill {
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly underlineStyle: UnderlineStyle;
  readonly underlineThickness: UnderlineThickness;

  constructor(init: TextFormatInit = {}) {
    this.rangeStart = init.rangeStart ?? 0;
    this.rangeEnd = init.rangeEnd ?? 0;

    // WebIDL enum validation: invalid values throw TypeError
    if (
      init.underlineStyle !== undefined &&
      !VALID_UNDERLINE_STYLES.has(init.underlineStyle as string)
    ) {
      throw new TypeError(
        `Failed to construct 'TextFormat': The provided value '${init.underlineStyle}' is not a valid enum value of type UnderlineStyle.`,
      );
    }
    if (
      init.underlineThickness !== undefined &&
      !VALID_UNDERLINE_THICKNESSES.has(init.underlineThickness as string)
    ) {
      throw new TypeError(
        `Failed to construct 'TextFormat': The provided value '${init.underlineThickness}' is not a valid enum value of type UnderlineThickness.`,
      );
    }

    this.underlineStyle = init.underlineStyle ?? "none";
    this.underlineThickness = init.underlineThickness ?? "none";
  }
}

// TextFormatUpdateEvent — carries a list of TextFormat objects during composition
export interface TextFormatUpdateEventInit extends EventInit {
  textFormats?: TextFormatPolyfill[];
}

export class TextFormatUpdateEventPolyfill extends Event {
  #textFormats: TextFormatPolyfill[];

  constructor(type: string, init: TextFormatUpdateEventInit = {}) {
    super(type, init);
    this.#textFormats = init.textFormats ? [...init.textFormats] : [];
  }

  getTextFormats(): TextFormatPolyfill[] {
    return [...this.#textFormats];
  }
}

// CharacterBoundsUpdateEvent — requests character bounds for a range
export interface CharacterBoundsUpdateEventInit extends EventInit {
  rangeStart?: number;
  rangeEnd?: number;
}

export class CharacterBoundsUpdateEventPolyfill extends Event {
  readonly rangeStart: number;
  readonly rangeEnd: number;

  constructor(type: string, init: CharacterBoundsUpdateEventInit = {}) {
    super(type, init);
    this.rangeStart = init.rangeStart ?? 0;
    this.rangeEnd = init.rangeEnd ?? 0;
  }
}
