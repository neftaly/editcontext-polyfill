import type { EditContextPolyfill } from "./edit-context.js";

const contextByElement = new WeakMap<HTMLElement, EditContextPolyfill | null>();

export function getEditContext(element: HTMLElement): EditContextPolyfill | null {
  return contextByElement.get(element) ?? null;
}

export function setEditContext(element: HTMLElement, context: EditContextPolyfill | null): void {
  contextByElement.set(element, context);
}

// --- Editability / host lookup ---

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

    if (current.parentElement) {
      current = current.parentElement;
    } else {
      const root = current.getRootNode();
      current = root instanceof ShadowRoot ? (root.host as HTMLElement) : null;
    }
  }
  return result;
}
