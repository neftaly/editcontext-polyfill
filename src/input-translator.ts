// Translates textarea input events into EditContext internal method calls.
// Composition uses preventDefault + explicit range tracking via EditContext's
// _setComposition/_commitText. Non-composition handled types (insertText,
// delete*) call _insertText/_deleteBackward/etc. directly.

import type { EditContextPolyfill } from "./edit-context.js";
import { HANDLED_INPUT_TYPES, SUPPRESSED_INPUT_TYPES } from "./constants.js";

export interface InputTranslator {
  destroy: () => void;
  syncFromEditContext: () => void;
}

const DELETE_DISPATCH: Readonly<Record<string, (ec: EditContextPolyfill) => void>> = {
  deleteContentBackward: (ec) => ec._deleteBackward(),
  deleteContentForward: (ec) => ec._deleteForward(),
  deleteWordBackward: (ec) => ec._deleteWordBackward(),
  deleteWordForward: (ec) => ec._deleteWordForward(),
  deleteContent: (ec) => ec._deleteBackward(),
};

const KEYBOARD_EVENT_PROPS = [
  "key",
  "code",
  "location",
  "ctrlKey",
  "shiftKey",
  "altKey",
  "metaKey",
  "repeat",
  "isComposing",
] as const;

// Keys whose default textarea behavior moves the cursor/selection.
// Chrome native EditContext does NOT update selection for these.
const NAVIGATION_KEYS: ReadonlySet<string> = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

function createForwardedKeyboardEvent(event: KeyboardEvent): KeyboardEvent {
  const init: KeyboardEventInit = {};
  for (const prop of KEYBOARD_EVENT_PROPS) {
    (init as Record<string, unknown>)[prop] = event[prop];
  }
  init.bubbles = true;
  init.cancelable = true;
  init.composed = true;
  return new KeyboardEvent(event.type, init);
}

// Normalize Firefox's insertLineBreak to Chrome's insertParagraph for plain Enter.
// Also remap Ctrl+Backspace/Delete with a selection: the textarea fires
// deleteContentBackward/Forward (selection deletion), but Chrome's native
// EditContext always fires deleteWord* to reflect the keypress intent.
function normalizeInputType(inputType: string, shiftHeld: boolean, ctrlHeld: boolean): string {
  if (inputType === "insertLineBreak" && !shiftHeld) return "insertParagraph";
  if (ctrlHeld) {
    if (inputType === "deleteContentBackward") return "deleteWordBackward";
    if (inputType === "deleteContentForward") return "deleteWordForward";
  }
  return inputType;
}

// inputTypes where Chrome native EditContext sets beforeinput.data to null
// (paste/drop data is available via event.dataTransfer, not event.data).
const DATA_NULL_INPUT_TYPES: ReadonlySet<string> = new Set(["insertFromPaste", "insertFromDrop"]);

function createSyntheticBeforeInput(inputType: string, event: InputEvent): InputEvent {
  const init: InputEventInit = {
    inputType,
    data: DATA_NULL_INPUT_TYPES.has(inputType) ? null : event.data,
    cancelable: true,
    bubbles: true,
    composed: true,
  };
  if (event.dataTransfer) init.dataTransfer = event.dataTransfer;
  return new InputEvent("beforeinput", init);
}

export function createInputTranslator(
  textarea: HTMLTextAreaElement,
  getEditContext: () => EditContextPolyfill | null,
  getAttachedElement: () => HTMLElement | null,
): InputTranslator {
  // Track modifier state from keydown for input type normalization
  let shiftHeld = false;
  let ctrlHeld = false;
  // Track whether we're mid-composition (from the textarea's perspective)
  let textareaComposing = false;

  function syncFromEditContext(): void {
    const editContext = getEditContext();
    if (!editContext) return;

    // Don't sync textarea.value during composition — setting value
    // programmatically disrupts the browser's native IME tracking,
    // causing subsequent imeSetComposition calls to be swallowed.
    if (!editContext.isComposing) {
      textarea.value = editContext.text;
    }
    const start = Math.min(editContext.selectionStart, editContext.selectionEnd);
    const end = Math.max(editContext.selectionStart, editContext.selectionEnd);
    textarea.setSelectionRange(
      start,
      end,
      editContext.selectionStart > editContext.selectionEnd ? "backward" : "forward",
    );
  }

  // Whether the textarea is inside a shadow root. When true, keyboard,
  // clipboard, and composition events naturally bubble to the host element
  // via shadow DOM retargeting, so we must NOT dispatch synthetic copies.
  const inShadow = textarea.getRootNode() instanceof ShadowRoot;

  function forwardKeyboardEvent(event: KeyboardEvent): void {
    if (event.type === "keydown") {
      shiftHeld = event.shiftKey;
      ctrlHeld = event.ctrlKey || event.metaKey;
      // Ensure textarea is in sync before processing key events. Chrome may
      // asynchronously reset the textarea's selection after addRange() on
      // light DOM conflicts with shadow-hosted textarea focus.
      syncFromEditContext();
    }

    const attachedElement = getAttachedElement();
    if (!attachedElement) return;

    if (!inShadow) {
      if (!attachedElement.dispatchEvent(createForwardedKeyboardEvent(event))) {
        event.preventDefault();
        return;
      }
    }

    // Prevent navigation keys from moving the textarea cursor.
    // Also prevent Ctrl+A/Z/Y which would mutate textarea outside EditContext flow.
    if (event.type === "keydown") {
      if (NAVIGATION_KEYS.has(event.key)) {
        event.preventDefault();
      } else if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        const k = event.key.toLowerCase();
        if (k === "a" || k === "z" || k === "y") {
          event.preventDefault();
        }
      }
    }
  }

  function handleBeforeInput(event: Event): void {
    if (!(event instanceof InputEvent)) return;
    const editContext = getEditContext();
    const attachedElement = getAttachedElement();
    if (!editContext || !attachedElement) return;

    const inputType = normalizeInputType(event.inputType, shiftHeld, ctrlHeld);
    const isComposition = inputType === "insertCompositionText";
    const isHandled = HANDLED_INPUT_TYPES.has(inputType);
    const isSuppressed = SUPPRESSED_INPUT_TYPES.has(inputType);

    // If a non-composition input arrives while the EditContext is composing,
    // Chrome's native EditContext keeps the composition range intact but
    // "suspends" it — no compositionend event fires, updateSelection won't
    // cancel it, and a subsequent imeSetComposition resumes it (no extra
    // compositionstart). On blur/detach, compositionend data reflects the
    // CURRENT text at the composition range.
    if (!isComposition && editContext.isComposing) {
      textareaComposing = false;
      editContext._suspendComposition();
      syncFromEditContext();
    }

    // Chrome doesn't fire beforeinput for composition or suppressed types on the element.
    if (!isSuppressed && !isComposition) {
      // Stop the natural event from also reaching the host via shadow DOM
      if (inShadow) event.stopPropagation();

      const syntheticBeforeInput = createSyntheticBeforeInput(inputType, event);

      if (!attachedElement.dispatchEvent(syntheticBeforeInput)) {
        event.preventDefault();
        return;
      }
    }

    // Composition: suppress and route through EditContext's _setComposition.
    // Chrome native EditContext never fires beforeinput:insertCompositionText
    // on the element, so stop the textarea's event from bubbling through shadow DOM.
    if (isComposition) {
      if (inShadow) event.stopPropagation();
      event.preventDefault();
      const data = event.data ?? "";
      editContext._setComposition(data, data.length, data.length);
      syncFromEditContext();
      return;
    }

    if (isHandled) {
      event.preventDefault();

      if (inputType === "insertText" || inputType === "insertTranspose") {
        editContext._insertText(event.data ?? "");
      } else {
        DELETE_DISPATCH[inputType]?.(editContext);
      }

      syncFromEditContext();
      return;
    }

    // Non-handled types (insertParagraph, insertFromPaste, etc.): prevent
    // textarea mutation — the app handles these itself, matching Chrome.
    event.preventDefault();
  }

  function handleCompositionStart(): void {
    textareaComposing = true;
    // Don't fire compositionstart on EditContext yet — that happens in
    // _setComposition when the first non-empty text arrives.
  }

  function handleCompositionEnd(_event: CompositionEvent): void {
    if (!textareaComposing) return;
    textareaComposing = false;

    const editContext = getEditContext();
    if (!editContext) return;

    // The composition ended. If the EditContext is still composing,
    // finish it. The committed text is in event.data.
    if (editContext.isComposing) {
      // Use _finishComposingText (keeps text as-is, just fires compositionend)
      // because the last _setComposition already placed the correct text.
      editContext._finishComposingText(true);
    }

    syncFromEditContext();
  }

  // Safety net: if beforeinput was properly handled, preventDefault() suppresses
  // the input event. Reaching here means beforeinput didn't fire (WebKit edge
  // case for Delete at boundary, Enter, etc.) and the textarea mutated
  // without the polyfill intercepting it. Process the mutation into EditContext
  // and forward a synthetic beforeinput to the attached element.
  function handleInput(event: Event): void {
    // Chrome's native EditContext never fires input events on the element.
    // Stop any leaking through shadow DOM retargeting.
    if (inShadow) event.stopPropagation();

    if (!(event instanceof InputEvent)) return;
    const editContext = getEditContext();
    if (!editContext) return;

    const inputType = normalizeInputType(event.inputType, shiftHeld, ctrlHeld);

    // Composition inputs are handled by the composition flow.
    if (inputType === "insertCompositionText") return;

    // Suspend composition if a non-composition input slipped through.
    if (editContext.isComposing) {
      textareaComposing = false;
      editContext._suspendComposition();
    }

    // Process the mutation into EditContext state.
    const isHandled = HANDLED_INPUT_TYPES.has(inputType);
    if (isHandled) {
      if (inputType === "insertText" || inputType === "insertTranspose") {
        editContext._insertText(event.data ?? "");
      } else {
        DELETE_DISPATCH[inputType]?.(editContext);
      }
    }

    // Forward synthetic beforeinput to the attached element.
    const attachedElement = getAttachedElement();
    if (attachedElement && !SUPPRESSED_INPUT_TYPES.has(inputType)) {
      const syntheticEvent = createSyntheticBeforeInput(inputType, event);
      attachedElement.dispatchEvent(syntheticEvent);
    }

    syncFromEditContext();
  }

  function forwardClipboardEvent(event: ClipboardEvent): void {
    if (inShadow) return; // Shadow DOM retargets clipboard events naturally
    const attachedElement = getAttachedElement();
    if (!attachedElement) return;

    const forwarded = new ClipboardEvent(event.type, {
      bubbles: true,
      cancelable: event.cancelable,
      composed: true,
      clipboardData: event.clipboardData,
    });

    if (!attachedElement.dispatchEvent(forwarded)) {
      event.preventDefault();
    }
  }

  textarea.addEventListener("beforeinput", handleBeforeInput);
  textarea.addEventListener("input", handleInput);
  textarea.addEventListener("compositionstart", handleCompositionStart);
  textarea.addEventListener("compositionend", handleCompositionEnd);
  textarea.addEventListener("keydown", forwardKeyboardEvent);
  textarea.addEventListener("keyup", forwardKeyboardEvent);
  textarea.addEventListener("copy", forwardClipboardEvent);
  textarea.addEventListener("cut", forwardClipboardEvent);
  textarea.addEventListener("paste", forwardClipboardEvent);

  function destroy(): void {
    textarea.removeEventListener("beforeinput", handleBeforeInput);
    textarea.removeEventListener("input", handleInput);
    textarea.removeEventListener("compositionstart", handleCompositionStart);
    textarea.removeEventListener("compositionend", handleCompositionEnd);
    textarea.removeEventListener("keydown", forwardKeyboardEvent);
    textarea.removeEventListener("keyup", forwardKeyboardEvent);
    textarea.removeEventListener("copy", forwardClipboardEvent);
    textarea.removeEventListener("cut", forwardClipboardEvent);
    textarea.removeEventListener("paste", forwardClipboardEvent);
  }

  return { destroy, syncFromEditContext };
}
