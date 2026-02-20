// EditContext polyfill — thin imperative shell over pure state transitions.
// Holds EditContextState, delegates to pure functions, dispatches DOM events from effects.

import {
  type EditContextState,
  type EditContextTransition,
  createState,
  updateText,
  updateSelection,
  setComposition,
  commitText,
  insertText,
  cancelComposition,
  finishComposingText,
  suspendComposition,
  deleteBackward,
  deleteForward,
  deleteWordBackward,
  deleteWordForward,
} from "./edit-context-state.js";
import {
  TextUpdateEventPolyfill,
  TextFormatUpdateEventPolyfill,
  TextFormatPolyfill,
  CharacterBoundsUpdateEventPolyfill,
} from "./event-types.js";

export interface EditContextInit {
  text?: string;
  selectionStart?: number;
  selectionEnd?: number;
}

type EditContextEventHandler = ((event: Event) => void) | null;

let controlBoundsWarned = false;

// WeakMap for on* handler storage (keeps data private while allowing
// dynamic property definitions on the prototype after the class).
const handlerMaps = new WeakMap<EditContextPolyfill, Map<string, (event: Event) => void>>();

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: interface merge is intentional for dynamic on* properties
export class EditContextPolyfill extends EventTarget {
  #state: EditContextState;
  #characterBoundsRangeStart = 0;
  #characterBounds: DOMRect[] = [];
  #attachedElement: HTMLElement | null = null;
  #deferredCompositionEnd: string | null = null;

  /** @internal — called when text/selection changes so the hidden textarea can sync */
  _onStateChange: (() => void) | null = null;
  /** @internal — called when selection bounds change for IME positioning */
  _onSelectionBoundsChange: ((bounds: DOMRect) => void) | null = null;

  constructor(init: EditContextInit = {}) {
    super();
    this.#state = createState(init);
    handlerMaps.set(this, new Map());
  }

  get text(): string {
    return this.#state.text;
  }

  get selectionStart(): number {
    return this.#state.selectionStart;
  }

  get selectionEnd(): number {
    return this.#state.selectionEnd;
  }

  get characterBoundsRangeStart(): number {
    return this.#characterBoundsRangeStart;
  }

  get isComposing(): boolean {
    // A suspended composition is internally tracked (composing=true) for range
    // persistence, but externally it behaves as if composing ended — the IME
    // pipeline is no longer active, the textarea should sync, etc.
    return this.#state.composing && !this.#state.compositionSuspended;
  }

  #apply({ state, effects }: EditContextTransition): void {
    const prev = this.#state;
    this.#state = state;

    for (const effect of effects) {
      switch (effect.type) {
        case "textupdate":
          this.dispatchEvent(
            new TextUpdateEventPolyfill("textupdate", {
              text: effect.text,
              updateRangeStart: effect.updateRangeStart,
              updateRangeEnd: effect.updateRangeEnd,
              selectionStart: effect.selectionStart,
              selectionEnd: effect.selectionEnd,
            }),
          );
          break;
        case "compositionstart":
          // A new composition supersedes any deferred compositionend
          this.#deferredCompositionEnd = null;
          this.dispatchEvent(new CompositionEvent("compositionstart", { data: effect.data }));
          break;
        case "compositionend":
          // Real compositionend clears any deferred one
          this.#deferredCompositionEnd = null;
          this.dispatchEvent(new CompositionEvent("compositionend", { data: effect.data }));
          break;
      }
    }

    if (
      prev.text !== state.text ||
      prev.selectionStart !== state.selectionStart ||
      prev.selectionEnd !== state.selectionEnd
    ) {
      this._onStateChange?.();
    }
  }

  characterBounds(): DOMRect[] {
    return this.#characterBounds.map((r) => new DOMRect(r.x, r.y, r.width, r.height));
  }

  attachedElements(): HTMLElement[] {
    return this.#attachedElement ? [this.#attachedElement] : [];
  }

  updateText(rangeStart: number, rangeEnd: number, newText: string): void {
    this.#apply(updateText(this.#state, rangeStart, rangeEnd, newText));
  }

  updateSelection(start: number, end: number): void {
    this.#apply(updateSelection(this.#state, start, end));
  }

  updateControlBounds(_controlBounds: DOMRect): void {
    if (process.env.NODE_ENV !== "production" && !controlBoundsWarned) {
      controlBoundsWarned = true;
      console.warn("[editcontext-polyfill] updateControlBounds() has no effect in the polyfill.");
    }
  }

  updateSelectionBounds(selectionBounds: DOMRect): void {
    this._onSelectionBoundsChange?.(selectionBounds);
  }

  updateCharacterBounds(rangeStart: number, characterBounds: DOMRect[]): void {
    this.#characterBoundsRangeStart = rangeStart;
    this.#characterBounds = [...characterBounds];
  }

  // --- Internal methods (called by input-translator and focus-manager) ---

  _setComposition(text: string, selectionStart: number, selectionEnd: number): void {
    // If resuming a suspended composition, clear the deferred compositionend
    // — the composition is active again and will end normally later.
    if (text !== "" && this.#state.compositionSuspended) {
      this.#deferredCompositionEnd = null;
    }
    this.#apply(setComposition(this.#state, text, selectionStart, selectionEnd));

    // Dispatch textformatupdate and characterboundsupdate during active
    // composition.  The polyfill cannot access OS-level IME format data, so
    // it provides a default format (solid thin underline over the entire
    // composition range) matching the default Chrome/CDP behavior.
    if (this.#state.composing && !this.#state.compositionSuspended) {
      const rangeStart = this.#state.compositionRangeStart;
      const rangeEnd = this.#state.compositionRangeEnd;
      if (rangeEnd > rangeStart) {
        this.dispatchEvent(
          new TextFormatUpdateEventPolyfill("textformatupdate", {
            textFormats: [
              new TextFormatPolyfill({
                rangeStart,
                rangeEnd,
                underlineStyle: "solid",
                underlineThickness: "thin",
              }),
            ],
          }),
        );
        this.dispatchEvent(
          new CharacterBoundsUpdateEventPolyfill("characterboundsupdate", {
            rangeStart,
            rangeEnd,
          }),
        );
      }
    }
  }

  _commitText(text: string): void {
    this.#apply(commitText(this.#state, text));
  }

  _insertText(text: string): void {
    this.#apply(insertText(this.#state, text));
  }

  _cancelComposition(): void {
    this.#apply(cancelComposition(this.#state));
  }

  _finishComposingText(keepSelection: boolean, explicitData?: string): void {
    this.#apply(finishComposingText(this.#state, keepSelection, explicitData));
  }

  // Suspend composition without events — non-IME input during active composition.
  _suspendComposition(): void {
    if (this.#state.composing && !this.#state.compositionSuspended) {
      this.#state = suspendComposition(this.#state);
      // Mark that we need a deferred compositionend on blur/detach.
      // The actual data will be read at flush time from the composition range.
      this.#deferredCompositionEnd = "pending";
    }
  }

  _deleteBackward(): void {
    this.#apply(deleteBackward(this.#state));
  }
  _deleteForward(): void {
    this.#apply(deleteForward(this.#state));
  }
  _deleteWordBackward(): void {
    this.#apply(deleteWordBackward(this.#state));
  }
  _deleteWordForward(): void {
    this.#apply(deleteWordForward(this.#state));
  }

  _blur(): void {
    if (this.#state.compositionSuspended) {
      // Suspended composition: flush the deferred compositionend (which reads
      // the current text at the composition range). Don't call
      // _finishComposingText — that would fire a duplicate compositionend.
      this._flushDeferredCompositionEnd();
    } else {
      this._finishComposingText(true);
      this._flushDeferredCompositionEnd();
    }
  }

  _flushDeferredCompositionEnd(): void {
    if (this.#deferredCompositionEnd !== null) {
      // Read the CURRENT text at the composition range — Chrome's compositionend
      // data reflects whatever text is at the range now, not what was there
      // when the composition was suspended.
      const data = this.#state.text.substring(
        this.#state.compositionRangeStart,
        this.#state.compositionRangeEnd,
      );
      this.#deferredCompositionEnd = null;
      // Clear the suspended composition range now that we've flushed
      this.#state = {
        ...this.#state,
        composing: false,
        compositionSuspended: false,
        compositionRangeStart: 0,
        compositionRangeEnd: 0,
      };
      this.dispatchEvent(new CompositionEvent("compositionend", { data }));
    }
  }

  _attachToElement(element: HTMLElement | null): void {
    this.#attachedElement = element;
  }
  _getAttachedElement(): HTMLElement | null {
    return this.#attachedElement;
  }

  get [Symbol.toStringTag](): string {
    return "EditContext";
  }
}

// Declare dynamic on* handler properties for TypeScript.
export interface EditContextPolyfill {
  ontextupdate: EditContextEventHandler;
  ontextformatupdate: EditContextEventHandler;
  oncharacterboundsupdate: EditContextEventHandler;
  oncompositionstart: EditContextEventHandler;
  oncompositionend: EditContextEventHandler;
}

// Generate on* handler properties dynamically instead of 5 handwritten pairs.
for (const name of [
  "textupdate",
  "textformatupdate",
  "characterboundsupdate",
  "compositionstart",
  "compositionend",
]) {
  Object.defineProperty(EditContextPolyfill.prototype, `on${name}`, {
    get(this: EditContextPolyfill): EditContextEventHandler {
      return handlerMaps.get(this)?.get(name) ?? null;
    },
    set(this: EditContextPolyfill, handler: EditContextEventHandler) {
      const handlers = handlerMaps.get(this)!;
      const current = handlers.get(name);
      if (current) this.removeEventListener(name, current);
      if (handler) {
        handlers.set(name, handler);
        this.addEventListener(name, handler);
      } else {
        handlers.delete(name);
      }
    },
    enumerable: true,
    configurable: true,
  });
}
