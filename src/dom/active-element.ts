export interface ActiveElementPatch {
  uninstall: () => void;
}

type ActiveElementGetter = (this: Document) => Element | null;

export function patchDocumentActiveElement(
  doc: Document,
  getReplacement: (actual: Element | null) => Element | null,
): ActiveElementPatch {
  const originalOwnDescriptor = Object.getOwnPropertyDescriptor(doc, "activeElement");
  const originalDescriptor =
    originalOwnDescriptor ?? Object.getOwnPropertyDescriptor(Document.prototype, "activeElement");

  if (!originalDescriptor?.get) return { uninstall: () => {} };

  const originalGet = originalDescriptor.get as ActiveElementGetter;

  try {
    Object.defineProperty(doc, "activeElement", {
      get() {
        const actual = originalGet.call(this);
        return getReplacement(actual) ?? actual;
      },
      configurable: true,
      enumerable: true,
    });
  } catch {
    return { uninstall: () => {} };
  }

  return {
    uninstall: () => {
      if (originalOwnDescriptor) {
        Object.defineProperty(doc, "activeElement", originalOwnDescriptor);
      } else {
        delete (doc as unknown as Record<string, unknown>).activeElement;
      }
    },
  };
}
