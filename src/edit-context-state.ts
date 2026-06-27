// Compatibility facade for the DOM-free EditContext core.
// Existing consumers should keep importing from this module.

export type {
  EditContextEffect,
  EditContextState,
  EditContextStateInit,
  EditContextTransition,
} from "./core/index.js";

export {
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
} from "./core/index.js";
