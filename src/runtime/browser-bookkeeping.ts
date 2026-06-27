export type SelectionBoundsChangeHandler = ((bounds: DOMRect) => void) | null;

let controlBoundsWarned = false;

export class EditContextBrowserBookkeeping {
  #characterBoundsRangeStart = 0;
  #characterBounds: DOMRect[] = [];
  #attachedElement: HTMLElement | null = null;

  onSelectionBoundsChange: SelectionBoundsChangeHandler = null;

  get characterBoundsRangeStart(): number {
    return this.#characterBoundsRangeStart;
  }

  characterBounds(): DOMRect[] {
    return this.#characterBounds.map((r) => new DOMRect(r.x, r.y, r.width, r.height));
  }

  attachedElements(): HTMLElement[] {
    return this.#attachedElement ? [this.#attachedElement] : [];
  }

  updateControlBounds(_controlBounds: DOMRect): void {
    if (process.env.NODE_ENV !== "production" && !controlBoundsWarned) {
      controlBoundsWarned = true;
      console.warn("[editcontext-polyfill] updateControlBounds() has no effect in the polyfill.");
    }
  }

  updateSelectionBounds(selectionBounds: DOMRect): void {
    this.onSelectionBoundsChange?.(selectionBounds);
  }

  updateCharacterBounds(rangeStart: number, characterBounds: DOMRect[]): void {
    this.#characterBoundsRangeStart = rangeStart;
    this.#characterBounds = characterBounds.map(toEnclosingBlinkRect);
  }

  attachToElement(element: HTMLElement | null): void {
    this.#attachedElement = element;
  }

  getAttachedElement(): HTMLElement | null {
    return this.#attachedElement;
  }
}

const FLOAT_MAX = 3.4028234663852886e38;

function clampLikeBlinkFloat(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value > FLOAT_MAX) return FLOAT_MAX;
  if (value < -FLOAT_MAX) return -FLOAT_MAX;
  return value;
}

function toEnclosingBlinkRect(rect: DOMRect): DOMRect {
  const x = clampLikeBlinkFloat(rect.x);
  const y = clampLikeBlinkFloat(rect.y);
  const width = clampLikeBlinkFloat(rect.width);
  const height = clampLikeBlinkFloat(rect.height);
  const right = x + width;
  const bottom = y + height;

  const left = Math.floor(Math.min(x, right));
  const top = Math.floor(Math.min(y, bottom));
  const enclosingRight = Math.ceil(Math.max(x, right));
  const enclosingBottom = Math.ceil(Math.max(y, bottom));

  return new DOMRect(left, top, enclosingRight - left, enclosingBottom - top);
}
