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
import { TextUpdateEventPolyfill } from "./event-types.js";

export interface EditContextInit {
  text?: string;
  selectionStart?: number;
  selectionEnd?: number;
}

type EditContextEventHandler = ((event: Event) => void) | null;

const UNSUPPORTED_EVENTS: ReadonlySet<string> = new Set([
  "textformatupdate",
  "characterboundsupdate",
]);

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (process.env.NODE_ENV === "production") return;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[editcontext-polyfill] ${message}`);
}

export class EditContextPolyfill extends EventTarget {
  #state: EditContextState;
  #characterBoundsRangeStart = 0;
  #characterBounds: DOMRect[] = [];
  #attachedElement: HTMLElement | null = null;
  #handlers = new Map<string, (event: Event) => void>();
  #deferredCompositionEnd: string | null = null;

  /** @internal — called when text/selection changes so the hidden textarea can sync */
  _onStateChange: (() => void) | null = null;
  /** @internal — called when selection bounds change for IME positioning */
  _onSelectionBoundsChange: ((bounds: DOMRect) => void) | null = null;

  constructor(init: EditContextInit = {}) {
    super();
    this.#state = createState(init);
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
    warnOnce("updateControlBounds", "updateControlBounds() has no effect in the polyfill.");
  }

  updateSelectionBounds(selectionBounds: DOMRect): void {
    this._onSelectionBoundsChange?.(selectionBounds);
  }

  updateCharacterBounds(rangeStart: number, characterBounds: DOMRect[]): void {
    this.#characterBoundsRangeStart = rangeStart;
    this.#characterBounds = [...characterBounds];
  }

  // --- Internal methods (called by input-translator and focus-manager) ---

  /** @internal — Chrome's SetComposition */
  _setComposition(text: string, selectionStart: number, selectionEnd: number): void {
    // If resuming a suspended composition, clear the deferred compositionend
    // — the composition is active again and will end normally later.
    if (text !== "" && this.#state.compositionSuspended) {
      this.#deferredCompositionEnd = null;
    }
    this.#apply(setComposition(this.#state, text, selectionStart, selectionEnd));
  }

  /** @internal — Chrome's CommitText */
  _commitText(text: string): void {
    this.#apply(commitText(this.#state, text));
  }

  /** @internal — Chrome's InsertText (non-IME) */
  _insertText(text: string): void {
    this.#apply(insertText(this.#state, text));
  }

  /** @internal — Chrome's OnCancelComposition */
  _cancelComposition(): void {
    this.#apply(cancelComposition(this.#state));
  }

  /** @internal — Chrome's FinishComposingText (called on blur/focus change) */
  _finishComposingText(keepSelection: boolean): void {
    this.#apply(finishComposingText(this.#state, keepSelection));
  }

  /** @internal — Suspend the active composition without dispatching events.
   *  Chrome's native EditContext keeps the composition range intact when non-IME
   *  input (e.g. insertText) arrives during active composition — no
   *  compositionend event is fired immediately. The composition is "suspended":
   *  updateSelection won't cancel it, and a subsequent imeSetComposition
   *  resumes it (no extra compositionstart). On blur/detach,
   *  _flushDeferredCompositionEnd reads the CURRENT text at the composition
   *  range for the deferred compositionend data. */
  _suspendComposition(): void {
    if (this.#state.composing && !this.#state.compositionSuspended) {
      this.#state = suspendComposition(this.#state);
      // Mark that we need a deferred compositionend on blur/detach.
      // The actual data will be read at flush time from the composition range.
      this.#deferredCompositionEnd = "pending";
    }
  }

  /** @internal — Chrome's DeleteBackward */
  _deleteBackward(): void {
    this.#apply(deleteBackward(this.#state));
  }

  /** @internal — Chrome's DeleteForward */
  _deleteForward(): void {
    this.#apply(deleteForward(this.#state));
  }

  /** @internal — Chrome's DeleteWordBackward */
  _deleteWordBackward(): void {
    this.#apply(deleteWordBackward(this.#state));
  }

  /** @internal — Chrome's DeleteWordForward */
  _deleteWordForward(): void {
    this.#apply(deleteWordForward(this.#state));
  }

  /** @internal — Chrome's Focus */
  _focus(): void {}

  /** @internal — Chrome's Blur */
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

  /** @internal — Flush a deferred compositionend from a prior composition suspension. */
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

  /** @internal */
  _attachToElement(element: HTMLElement | null): void {
    this.#attachedElement = element;
  }

  /** @internal */
  _getAttachedElement(): HTMLElement | null {
    return this.#attachedElement;
  }

  addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (UNSUPPORTED_EVENTS.has(type)) {
      warnOnce(type, `"${type}" event is never dispatched by the polyfill.`);
    }
    super.addEventListener(type, callback, options);
  }

  #getHandler(name: string): EditContextEventHandler {
    return this.#handlers.get(name) ?? null;
  }

  #setHandler(name: string, handler: EditContextEventHandler): void {
    const current = this.#handlers.get(name);
    if (current) this.removeEventListener(name, current);
    if (handler) {
      this.#handlers.set(name, handler);
      this.addEventListener(name, handler);
    } else {
      this.#handlers.delete(name);
    }
  }

  get ontextupdate(): EditContextEventHandler {
    return this.#getHandler("textupdate");
  }
  set ontextupdate(handler: EditContextEventHandler) {
    this.#setHandler("textupdate", handler);
  }

  get ontextformatupdate(): EditContextEventHandler {
    return this.#getHandler("textformatupdate");
  }
  set ontextformatupdate(handler: EditContextEventHandler) {
    this.#setHandler("textformatupdate", handler);
  }

  get oncharacterboundsupdate(): EditContextEventHandler {
    return this.#getHandler("characterboundsupdate");
  }
  set oncharacterboundsupdate(handler: EditContextEventHandler) {
    this.#setHandler("characterboundsupdate", handler);
  }

  get oncompositionstart(): EditContextEventHandler {
    return this.#getHandler("compositionstart");
  }
  set oncompositionstart(handler: EditContextEventHandler) {
    this.#setHandler("compositionstart", handler);
  }

  get oncompositionend(): EditContextEventHandler {
    return this.#getHandler("compositionend");
  }
  set oncompositionend(handler: EditContextEventHandler) {
    this.#setHandler("compositionend", handler);
  }

  get [Symbol.toStringTag](): string {
    return "EditContext";
  }
}
