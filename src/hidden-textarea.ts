// Creates a visually-hidden textarea that captures keyboard/IME input.
// When possible, the textarea is placed inside a shadow root on the host
// element so that :focus CSS matches the host (shadow DOM retargets focus
// to the shadow host from outside).

export interface HiddenTextarea {
  element: HTMLTextAreaElement;
  destroy: () => void;
}

// Track elements where we've attached a shadow root (permanent).
const shadowRoots = new WeakMap<HTMLElement, ShadowRoot>();

/**
 * Ensure the host has a shadow root with a <slot> for light DOM children.
 * Returns the shadow root, or null if shadow DOM isn't available (e.g. canvas).
 */
export function ensureShadowRoot(host: HTMLElement): ShadowRoot | null {
  const existing = shadowRoots.get(host);
  if (existing) return existing;

  // Check for user-created shadow root
  if (host.shadowRoot) {
    shadowRoots.set(host, host.shadowRoot);
    return host.shadowRoot;
  }

  try {
    const shadow = host.attachShadow({ mode: "open" });
    // Slot preserves light DOM children visibility
    shadow.appendChild(host.ownerDocument.createElement("slot"));
    shadowRoots.set(host, shadow);
    return shadow;
  } catch {
    // Canvas and some other elements can't have shadow DOM
    return null;
  }
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
