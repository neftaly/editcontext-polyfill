// Renders caret and selection visually when document.getSelection().addRange()
// targets an active EditContext element. With native EditContext, the element
// has real focus so the browser renders selections natively. The polyfill
// redirects focus to a hidden textarea, so we render with CSS overlays instead.

import { isElementActive } from "./focus-manager.js";

let installed = false;
let originalAddRange: typeof Selection.prototype.addRange | null = null;
let originalRemoveAllRanges: typeof Selection.prototype.removeAllRanges | null = null;
const positionedHosts = new WeakSet<HTMLElement>();

let caretElement: HTMLElement | null = null;
let selectionOverlays: HTMLElement[] = [];
let blinkTimer: ReturnType<typeof setInterval> | null = null;
let suppressionStyle: HTMLStyleElement | null = null;

/** Walk up from a DOM node to find the active EditContext host element. */
function findActiveHost(node: Node): HTMLElement | null {
  let el: HTMLElement | null = node instanceof HTMLElement ? node : node.parentElement;
  while (el) {
    if (isElementActive(el)) return el;
    el = el.parentElement;
  }
  return null;
}

/** Remove all CSS-rendered caret/selection overlays. */
export function clearRendering(): void {
  if (blinkTimer !== null) {
    clearInterval(blinkTimer);
    blinkTimer = null;
  }
  if (caretElement) {
    caretElement.remove();
    caretElement = null;
  }
  for (const overlay of selectionOverlays) {
    overlay.remove();
  }
  selectionOverlays = [];
}

/** Convert a viewport-relative DOMRect to element-relative coordinates. */
function relativePosition(
  rect: DOMRect,
  host: HTMLElement,
  cs: CSSStyleDeclaration,
): { left: number; top: number } {
  const hostRect = host.getBoundingClientRect();
  const borderLeft = parseFloat(cs.borderLeftWidth) || 0;
  const borderTop = parseFloat(cs.borderTopWidth) || 0;
  return {
    left: rect.left - hostRect.left - borderLeft + host.scrollLeft,
    top: rect.top - hostRect.top - borderTop + host.scrollTop,
  };
}

/** Ensure the host has a positioned context for absolute children. */
function ensurePositioned(host: HTMLElement, cs: CSSStyleDeclaration): void {
  if (positionedHosts.has(host)) return;
  if (cs.position === "static") {
    host.style.position = "relative";
  }
  positionedHosts.add(host);
}

function renderCaret(range: Range, host: HTMLElement): void {
  const cs = getComputedStyle(host);
  ensurePositioned(host, cs);

  const rect = range.getBoundingClientRect();
  let height = rect.height;
  if (height === 0) {
    // Collapsed range at end of line — estimate height from font size
    height = parseFloat(cs.fontSize) * 1.2;
  }
  if (height === 0) return;

  const pos = relativePosition(rect, host, cs);

  caretElement = host.ownerDocument.createElement("div");
  caretElement.style.cssText = `position:absolute;left:${pos.left}px;top:${pos.top}px;width:2px;height:${height}px;background:#000;pointer-events:none;z-index:2147483647`;
  host.appendChild(caretElement);

  // Blink: restart on every render (keeps caret solid while typing,
  // then blinks after a pause — matches native Chrome behavior).
  let visible = true;
  blinkTimer = setInterval(() => {
    visible = !visible;
    if (caretElement) caretElement.style.opacity = visible ? "1" : "0";
  }, 500);
}

function renderSelection(range: Range, host: HTMLElement): void {
  const cs = getComputedStyle(host);
  ensurePositioned(host, cs);

  const rects = range.getClientRects();
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const pos = relativePosition(r, host, cs);
    const overlay = host.ownerDocument.createElement("div");
    overlay.style.cssText = `position:absolute;left:${pos.left}px;top:${pos.top}px;width:${r.width}px;height:${r.height}px;background:rgba(74,158,255,0.3);pointer-events:none;z-index:2147483646`;
    host.appendChild(overlay);
    selectionOverlays.push(overlay);
  }
}

function patchedAddRange(this: Selection, range: Range): void {
  // Always set the native selection (keeps Selection properties correct
  // and fires selectionchange for app handlers that depend on it).
  originalAddRange!.call(this, range);

  const host = findActiveHost(range.startContainer);
  if (!host) return;

  clearRendering();

  if (range.collapsed) {
    renderCaret(range, host);
  } else {
    renderSelection(range, host);
  }
}

function patchedRemoveAllRanges(this: Selection): void {
  clearRendering();
  originalRemoveAllRanges!.call(this);
}

export function installSelectionRenderer(): void {
  if (installed) return;

  originalAddRange = Selection.prototype.addRange;
  originalRemoveAllRanges = Selection.prototype.removeAllRanges;

  Selection.prototype.addRange = patchedAddRange;
  Selection.prototype.removeAllRanges = patchedRemoveAllRanges;

  // Suppress native selection highlight on active EditContext hosts.
  // The DOM selection is kept for selectionchange events and API access,
  // but its visual rendering is hidden — the CSS overlay handles display.
  suppressionStyle = document.createElement("style");
  suppressionStyle.textContent =
    "[data-editcontext-active] ::selection, [data-editcontext-active]::selection { background: transparent; color: inherit; }";
  // document.head may not exist if install() runs before DOM is ready
  // (e.g. via addInitScript or early <script> in <head>). Defer to DOMContentLoaded.
  if (document.head) {
    document.head.appendChild(suppressionStyle);
  } else {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (suppressionStyle) document.head.appendChild(suppressionStyle);
      },
      { once: true },
    );
  }

  installed = true;
}

export function uninstallSelectionRenderer(): void {
  if (!installed) return;

  clearRendering();

  if (originalAddRange) Selection.prototype.addRange = originalAddRange;
  if (originalRemoveAllRanges) Selection.prototype.removeAllRanges = originalRemoveAllRanges;

  originalAddRange = null;
  originalRemoveAllRanges = null;

  if (suppressionStyle) {
    suppressionStyle.remove();
    suppressionStyle = null;
  }

  installed = false;
}
