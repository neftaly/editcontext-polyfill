// Browser input-event compatibility helpers used by the hidden textarea layer.

export const HANDLED_INPUT_TYPES: ReadonlySet<string> = new Set([
  "insertText",
  "insertTranspose",
  "deleteWordBackward",
  "deleteWordForward",
  "deleteContent",
  "deleteContentBackward",
  "deleteContentForward",
]);

// inputType values where Chrome does NOT fire beforeinput on the element.
export const SUPPRESSED_INPUT_TYPES: ReadonlySet<string> = new Set(["deleteByCut", "deleteByDrag"]);

// Normalize Firefox's insertLineBreak to Chrome's insertParagraph for plain Enter.
// Also remap Ctrl+Backspace/Delete with a selection: the textarea fires
// deleteContentBackward/Forward, but Chrome native EditContext reports the key intent.
export function normalizeInputType(
  inputType: string,
  shiftHeld: boolean,
  ctrlHeld: boolean,
): string {
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

export function createSyntheticBeforeInput(inputType: string, event: InputEvent): InputEvent {
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
