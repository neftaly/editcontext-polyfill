import {
  type EditContextState,
  type EditContextTransition,
  cancelComposition,
  commitText,
  createState,
  deleteBackward,
  deleteForward,
  deleteWordBackward,
  deleteWordForward,
  finishComposingText,
  insertText,
  setComposition,
  suspendComposition,
  updateSelection,
  updateText,
} from "../edit-context-state.js";
import {
  dispatchCompositionEnd,
  dispatchDefaultCompositionFormatRequests,
  dispatchEditContextEffect,
} from "./event-effects.js";

export interface EditContextRuntimeInit {
  text?: string;
  selectionStart?: number;
  selectionEnd?: number;
}

export type StateChangeHandler = (() => void) | null;

export class EditContextRuntime {
  #state: EditContextState;
  #deferredCompositionEnd = false;

  onStateChange: StateChangeHandler = null;

  constructor(
    init: EditContextRuntimeInit,
    private readonly eventTarget: EventTarget,
  ) {
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

  get isComposing(): boolean {
    // A suspended composition is internally tracked for range persistence, but
    // externally behaves as if the IME pipeline is no longer active.
    return this.#state.composing && !this.#state.compositionSuspended;
  }

  updateText(rangeStart: number, rangeEnd: number, newText: string): void {
    this.#apply(updateText(this.#state, rangeStart, rangeEnd, newText));
  }

  updateSelection(start: number, end: number): void {
    this.#apply(updateSelection(this.#state, start, end));
  }

  setComposition(text: string, selectionStart: number, selectionEnd: number): void {
    if (text !== "" && this.#state.compositionSuspended) {
      this.#deferredCompositionEnd = false;
    }
    this.#apply(setComposition(this.#state, text, selectionStart, selectionEnd));
    dispatchDefaultCompositionFormatRequests(this.eventTarget, this.#state);
  }

  commitText(text: string): void {
    this.#apply(commitText(this.#state, text));
  }

  insertText(text: string): void {
    this.#apply(insertText(this.#state, text));
  }

  cancelComposition(): void {
    this.#apply(cancelComposition(this.#state));
  }

  finishComposingText(keepSelection: boolean, explicitData?: string): void {
    this.#apply(finishComposingText(this.#state, keepSelection, explicitData));
  }

  suspendComposition(): void {
    if (this.#state.composing && !this.#state.compositionSuspended) {
      this.#state = suspendComposition(this.#state);
      this.#deferredCompositionEnd = true;
    }
  }

  deleteBackward(): void {
    this.#apply(deleteBackward(this.#state));
  }

  deleteForward(): void {
    this.#apply(deleteForward(this.#state));
  }

  deleteWordBackward(): void {
    this.#apply(deleteWordBackward(this.#state));
  }

  deleteWordForward(): void {
    this.#apply(deleteWordForward(this.#state));
  }

  blur(): void {
    if (this.#state.compositionSuspended) {
      this.flushDeferredCompositionEnd();
      return;
    }

    this.finishComposingText(true);
    this.flushDeferredCompositionEnd();
  }

  flushDeferredCompositionEnd(): void {
    if (!this.#deferredCompositionEnd) return;

    const data = this.#state.text.substring(
      this.#state.compositionRangeStart,
      this.#state.compositionRangeEnd,
    );
    this.#deferredCompositionEnd = false;
    this.#state = {
      ...this.#state,
      composing: false,
      compositionSuspended: false,
      compositionRangeStart: 0,
      compositionRangeEnd: 0,
    };
    dispatchCompositionEnd(this.eventTarget, data);
  }

  #apply({ state, effects }: EditContextTransition): void {
    const prev = this.#state;
    this.#state = state;

    for (const effect of effects) {
      if (effect.type === "compositionstart" || effect.type === "compositionend") {
        this.#deferredCompositionEnd = false;
      }
      dispatchEditContextEffect(this.eventTarget, effect);
    }

    if (
      prev.text !== state.text ||
      prev.selectionStart !== state.selectionStart ||
      prev.selectionEnd !== state.selectionEnd
    ) {
      this.onStateChange?.();
    }
  }
}
