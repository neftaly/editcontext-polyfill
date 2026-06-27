// EditContext polyfill facade — public EventTarget surface over runtime modules.

import {
  EditContextBrowserBookkeeping,
  type SelectionBoundsChangeHandler,
} from "./runtime/browser-bookkeeping.js";
import { EditContextRuntime, type StateChangeHandler } from "./runtime/edit-context-runtime.js";

export interface EditContextInit {
  text?: string;
  selectionStart?: number;
  selectionEnd?: number;
}

type EditContextEventHandler = ((event: Event) => void) | null;

// WeakMap for on* handler storage (keeps data private while allowing
// dynamic property definitions on the prototype after the class).
const handlerMaps = new WeakMap<EditContextPolyfill, Map<string, (event: Event) => void>>();

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: interface merge is intentional for dynamic on* properties
export class EditContextPolyfill extends EventTarget {
  #runtime: EditContextRuntime;
  #browser: EditContextBrowserBookkeeping;

  constructor(init: EditContextInit = {}) {
    super();
    this.#runtime = new EditContextRuntime(init, this);
    this.#browser = new EditContextBrowserBookkeeping();
    handlerMaps.set(this, new Map());
  }

  get text(): string {
    return this.#runtime.text;
  }

  get selectionStart(): number {
    return this.#runtime.selectionStart;
  }

  get selectionEnd(): number {
    return this.#runtime.selectionEnd;
  }

  get characterBoundsRangeStart(): number {
    return this.#browser.characterBoundsRangeStart;
  }

  get isComposing(): boolean {
    return this.#runtime.isComposing;
  }

  /** @internal — called when text/selection changes so the hidden textarea can sync */
  get _onStateChange(): StateChangeHandler {
    return this.#runtime.onStateChange;
  }

  /** @internal */
  set _onStateChange(handler: StateChangeHandler) {
    this.#runtime.onStateChange = handler;
  }

  /** @internal — called when selection bounds change for IME positioning */
  get _onSelectionBoundsChange(): SelectionBoundsChangeHandler {
    return this.#browser.onSelectionBoundsChange;
  }

  /** @internal */
  set _onSelectionBoundsChange(handler: SelectionBoundsChangeHandler) {
    this.#browser.onSelectionBoundsChange = handler;
  }

  characterBounds(): DOMRect[] {
    return this.#browser.characterBounds();
  }

  attachedElements(): HTMLElement[] {
    return this.#browser.attachedElements();
  }

  updateText(rangeStart: number, rangeEnd: number, newText: string): void {
    this.#runtime.updateText(rangeStart, rangeEnd, newText);
  }

  updateSelection(start: number, end: number): void {
    this.#runtime.updateSelection(start, end);
  }

  updateControlBounds(controlBounds: DOMRect): void {
    this.#browser.updateControlBounds(controlBounds);
  }

  updateSelectionBounds(selectionBounds: DOMRect): void {
    this.#browser.updateSelectionBounds(selectionBounds);
  }

  updateCharacterBounds(rangeStart: number, characterBounds: DOMRect[]): void {
    this.#browser.updateCharacterBounds(rangeStart, characterBounds);
  }

  // --- Internal methods (called by input-translator and focus-manager) ---

  _setComposition(text: string, selectionStart: number, selectionEnd: number): void {
    this.#runtime.setComposition(text, selectionStart, selectionEnd);
  }

  _commitText(text: string): void {
    this.#runtime.commitText(text);
  }

  _insertText(text: string): void {
    this.#runtime.insertText(text);
  }

  _cancelComposition(): void {
    this.#runtime.cancelComposition();
  }

  _finishComposingText(keepSelection: boolean, explicitData?: string): void {
    this.#runtime.finishComposingText(keepSelection, explicitData);
  }

  // Suspend composition without events — non-IME input during active composition.
  _suspendComposition(): void {
    this.#runtime.suspendComposition();
  }

  _deleteBackward(): void {
    this.#runtime.deleteBackward();
  }
  _deleteForward(): void {
    this.#runtime.deleteForward();
  }
  _deleteWordBackward(): void {
    this.#runtime.deleteWordBackward();
  }
  _deleteWordForward(): void {
    this.#runtime.deleteWordForward();
  }

  _blur(): void {
    this.#runtime.blur();
  }

  _flushDeferredCompositionEnd(): void {
    this.#runtime.flushDeferredCompositionEnd();
  }

  _attachToElement(element: HTMLElement | null): void {
    this.#browser.attachToElement(element);
  }
  _getAttachedElement(): HTMLElement | null {
    return this.#browser.getAttachedElement();
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
