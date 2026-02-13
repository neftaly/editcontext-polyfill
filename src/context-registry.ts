import type { EditContextPolyfill } from "./edit-context.js";

const contextByElement = new WeakMap<HTMLElement, EditContextPolyfill | null>();

export function getEditContext(element: HTMLElement): EditContextPolyfill | null {
  return contextByElement.get(element) ?? null;
}

export function setEditContext(element: HTMLElement, context: EditContextPolyfill | null): void {
  contextByElement.set(element, context);
}
