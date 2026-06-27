// Creates a visually-hidden textarea that captures keyboard/IME input.
// When possible, the textarea is placed inside a shadow root on the host
// element so that :focus CSS matches the host (shadow DOM retargets focus
// to the shadow host from outside).

import { ensureShadowRoot } from "./dom/shadow-host.js";

export interface HiddenTextarea {
  element: HTMLTextAreaElement;
  destroy: () => void;
}

export function createHiddenTextarea(host: HTMLElement): HiddenTextarea {
  const ownerDocument = host.ownerDocument;
  const textarea = ownerDocument.createElement("textarea");
  textarea.setAttribute("autocomplete", "off");
  textarea.setAttribute("autocorrect", "off");
  textarea.setAttribute("autocapitalize", "off");
  textarea.setAttribute("spellcheck", "false");
  textarea.setAttribute("aria-hidden", "true");
  // Prevent text wrapping — Firefox's word/line deletion boundaries depend on
  // visual line layout, so wrapping in a tiny textarea breaks them.
  textarea.setAttribute("wrap", "off");
  textarea.tabIndex = -1;

  Object.assign(textarea.style, {
    position: "fixed",
    top: "0px",
    left: "0px",
    width: "1px",
    height: "1px",
    padding: "0",
    border: "none",
    outline: "none",
    opacity: "0",
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: "-1",
  });

  // Prefer shadow root so :focus matches the host element.
  // Fall back to document.body (canvas can't have shadow DOM, and WebKit
  // doesn't reliably focus textarea children inside canvas elements).
  const shadow = ensureShadowRoot(host);
  if (shadow) {
    shadow.appendChild(textarea);
  } else {
    ownerDocument.body.appendChild(textarea);
  }

  return {
    element: textarea,
    destroy: () => textarea.remove(),
  };
}
