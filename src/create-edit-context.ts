// Framework-agnostic helper for creating and attaching an EditContext.
// Returns a destroy function for easy cleanup in useEffect / onUnmounted / etc.

import { install } from "./install.js";

export interface CreateEditContextOptions {
  text?: string;
  selectionStart?: number;
  selectionEnd?: number;
  onTextUpdate?: (event: Event) => void;
  onTextFormatUpdate?: (event: Event) => void;
  onCharacterBoundsUpdate?: (event: Event) => void;
  onCompositionStart?: (event: Event) => void;
  onCompositionEnd?: (event: Event) => void;
}

// Use the global EditContext constructor (native on Chrome, polyfill elsewhere).
// This avoids importing EditContextPolyfill directly, which would fail on Chrome
// where the native editContext setter rejects non-native instances.
function getEditContextConstructor(): new (init?: Record<string, unknown>) => EventTarget {
  return (globalThis as Record<string, unknown>).EditContext as new (
    init?: Record<string, unknown>,
  ) => EventTarget;
}

export function createEditContext(
  element: HTMLElement,
  options: CreateEditContextOptions = {},
): () => void {
  if (!element) {
    throw new TypeError("createEditContext: element is required");
  }

  // Ensure the polyfill is installed (no-op if native or already installed)
  install();

  const {
    text,
    selectionStart,
    selectionEnd,
    onTextUpdate,
    onTextFormatUpdate,
    onCharacterBoundsUpdate,
    onCompositionStart,
    onCompositionEnd,
  } = options;

  const EditContext = getEditContextConstructor();
  const ec = new EditContext({ text, selectionStart, selectionEnd });

  const eventHandlers: Record<string, ((event: Event) => void) | undefined> = {
    textupdate: onTextUpdate,
    textformatupdate: onTextFormatUpdate,
    characterboundsupdate: onCharacterBoundsUpdate,
    compositionstart: onCompositionStart,
    compositionend: onCompositionEnd,
  };

  const listeners: [string, (event: Event) => void][] = [];
  for (const [eventName, handler] of Object.entries(eventHandlers)) {
    if (handler) {
      ec.addEventListener(eventName, handler);
      listeners.push([eventName, handler]);
    }
  }

  (element as unknown as { editContext: EventTarget | null }).editContext = ec;

  return () => {
    for (const [eventName, handler] of listeners) {
      ec.removeEventListener(eventName, handler);
    }
    (element as unknown as { editContext: EventTarget | null }).editContext = null;
  };
}
