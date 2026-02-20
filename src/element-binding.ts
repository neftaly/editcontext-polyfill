import { EditContextPolyfill } from "./edit-context.js";
import {
  manageElement,
  unmanageElement,
  isElementActive,
  activateElement,
} from "./focus-manager.js";
import { getEditContext, setEditContext } from "./context-registry.js";

// EditContext can be set on valid shadow host elements plus canvas.
const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
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
  "canvas",
]);

let originalDescriptor: PropertyDescriptor | undefined;
let installed = false;

function canAttachEditContext(element: HTMLElement): boolean {
  const tagName = element.tagName.toLowerCase();
  if (tagName.includes("-")) return true; // custom elements
  return ALLOWED_ELEMENTS.has(tagName);
}

export function installEditContextProperty(): void {
  if (installed) return;

  originalDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "editContext");

  Object.defineProperty(HTMLElement.prototype, "editContext", {
    get(this: HTMLElement): EditContextPolyfill | null {
      return getEditContext(this);
    },
    set(this: HTMLElement, value: EditContextPolyfill | null) {
      if (value !== null && !(value instanceof EditContextPolyfill)) {
        throw new TypeError(
          "Failed to set the 'editContext' property on 'HTMLElement': " +
            "The provided value is not of type 'EditContext'.",
        );
      }

      if (value !== null && !canAttachEditContext(this)) {
        throw new DOMException(
          "Failed to set the 'editContext' property on 'HTMLElement': " +
            "This element does not support EditContext.",
          "NotSupportedError",
        );
      }

      const current = getEditContext(this);
      // Capture focus before detach destroys the hidden textarea.
      const wasFocused = isElementActive(this);

      if (current !== null) {
        // Finish any active composition before detaching (fires compositionend)
        if (wasFocused) current._blur();
        current._attachToElement(null);
        // Clear registry before unmanage so focusin doesn't find the old context
        setEditContext(this, null);
        unmanageElement(this);
      }

      if (value !== null) {
        const existingElement = value._getAttachedElement();
        if (existingElement !== null && existingElement !== this) {
          throw new DOMException(
            "Failed to set the 'editContext' property on 'HTMLElement': " +
              "The EditContext is already associated with another element.",
            "NotSupportedError",
          );
        }
        value._attachToElement(this);
        setEditContext(this, value);
        manageElement(this);
        // Activate if the element was focused before detach or currently has
        // DOM focus (e.g. blur→focus cycle between detach and reattach).
        if (wasFocused || document.activeElement === this) {
          activateElement(this);
        }
      } else if (wasFocused) {
        // Chrome retains element focus when editContext is removed.
        // Restore focus after deactivation destroys the hidden textarea.
        this.focus();
      }
    },
    enumerable: true,
    configurable: true,
  });

  installed = true;
}

export function uninstallEditContextProperty(): void {
  if (!installed) return;

  if (originalDescriptor) {
    Object.defineProperty(HTMLElement.prototype, "editContext", originalDescriptor);
  } else {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).editContext;
  }

  installed = false;
}
