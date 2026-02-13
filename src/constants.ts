// Elements that can host shadow DOM (valid shadow host names).
// See: https://html.spec.whatwg.org/multipage/dom.html#valid-shadow-host-name
const SHADOW_ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  "article",
  "aside",
  "blockquote",
  "body",
  "div",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "main",
  "nav",
  "p",
  "section",
  "span",
]);

// EditContext can be set on shadow-allowed elements plus canvas
export const EDIT_CONTEXT_ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  ...SHADOW_ALLOWED_ELEMENTS,
  "canvas",
]);

// inputType values that EditContext handles (suppress default DOM mutation).
// Matches Chrome's native EditContext behavior — only these 7 types produce
// textupdate events.
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
// Cut and drag go through system paths that bypass the element entirely.
// Note: insertFromPaste is NOT suppressed — Chrome fires beforeinput:insertFromPaste
// on the element (without producing a textupdate). insertFromDrop is also forwarded.
export const SUPPRESSED_INPUT_TYPES: ReadonlySet<string> = new Set(["deleteByCut", "deleteByDrag"]);
