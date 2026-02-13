// Walks the DOM tree to determine which EditContext should receive events
// for a given target element. Implements the spec's editability inheritance:
// - EditContext on an element makes it and its descendants editable
// - contenteditable="false" creates a non-editable boundary
// - Input/textarea elements handle their own input (bypass EditContext)

import { getEditContext } from "./context-registry.js";

export const FORM_CONTROL_TAGS: ReadonlySet<string> = new Set(["input", "textarea", "select"]);

export function findEditContextHost(target: HTMLElement): HTMLElement | null {
  if (FORM_CONTROL_TAGS.has(target.tagName.toLowerCase())) return null;

  let result: HTMLElement | null = null;
  let current: HTMLElement | null = target;
  while (current) {
    if (current.getAttribute("contenteditable") === "false") {
      if (result) break;
      return null;
    }
    if (getEditContext(current)) result = current;

    // Cross shadow DOM boundaries: if we're at a shadow root, jump to its host
    if (current.parentElement) {
      current = current.parentElement;
    } else {
      const root = current.getRootNode();
      if (root instanceof ShadowRoot) {
        current = root.host as HTMLElement;
      } else {
        current = null;
      }
    }
  }
  return result;
}
