// Handles mouse interactions (click-to-position, drag selection, double/triple
// click) for EditContext elements. The polyfill's focus redirection prevents the
// browser from creating native DOM selections on the editor element, so we
// recreate them manually using caretRangeFromPoint/caretPositionFromPoint.
// This triggers selectionchange events so apps work without modification.

import {
  caretRangeAtPoint,
  createRangeBetween,
  createTextContentRange,
  expandRangeToWord,
} from "./dom/caret-range.js";

export interface MouseHandler {
  onMouseDown(event: MouseEvent): void;
  destroy(): void;
}

export function createMouseHandler(host: HTMLElement, onSync?: () => void): MouseHandler {
  const doc = host.ownerDocument;
  let dragging = false;
  let anchorNode: Node | null = null;
  let anchorOffset = 0;
  let syncTimer: ReturnType<typeof setTimeout> | null = null;

  /** Schedule a deferred textarea re-sync. Chrome asynchronously resets the
   *  focused textarea's internal selection when the document's selection
   *  (set by addRange on light DOM nodes) conflicts with the shadow-hosted
   *  textarea. Re-syncing after a timeout lets all selection events settle. */
  function scheduleSync(): void {
    if (syncTimer !== null) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      onSync?.();
    }, 0);
  }

  function onMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return;

    const range = caretRangeAtPoint(doc, event.clientX, event.clientY);
    if (!range || !host.contains(range.startContainer)) return;

    const sel = doc.getSelection();
    if (!sel) return;

    // Triple+ click: select all text in the host
    if (event.detail >= 3) {
      const fullRange = createTextContentRange(host);
      if (!fullRange) return;
      sel.removeAllRanges();
      sel.addRange(fullRange);
      scheduleSync();
      return;
    }

    // Double click: select word
    if (event.detail === 2) {
      expandRangeToWord(range, host);
      sel.removeAllRanges();
      sel.addRange(range);
      scheduleSync();
      return;
    }

    // Shift+click: extend from current anchor to click point
    if (event.shiftKey && sel.anchorNode && host.contains(sel.anchorNode)) {
      const extRange = createRangeBetween(
        doc,
        sel.anchorNode,
        sel.anchorOffset,
        range.startContainer,
        range.startOffset,
      );
      sel.removeAllRanges();
      sel.addRange(extRange);
      scheduleSync();
      return;
    }

    // Single click: set cursor and start drag tracking
    sel.removeAllRanges();
    sel.addRange(range);
    scheduleSync();

    anchorNode = range.startContainer;
    anchorOffset = range.startOffset;
    dragging = true;
    doc.addEventListener("mousemove", onMouseMove);
    doc.addEventListener("mouseup", onMouseUp);
  }

  function onMouseMove(event: MouseEvent): void {
    if (!dragging || !anchorNode) return;

    const range = caretRangeAtPoint(doc, event.clientX, event.clientY);
    if (!range || !host.contains(range.startContainer)) return;

    const sel = doc.getSelection();
    if (!sel) return;

    const dragRange = createRangeBetween(
      doc,
      anchorNode,
      anchorOffset,
      range.startContainer,
      range.startOffset,
    );
    sel.removeAllRanges();
    sel.addRange(dragRange);
    scheduleSync();
  }

  function onMouseUp(): void {
    dragging = false;
    anchorNode = null;
    doc.removeEventListener("mousemove", onMouseMove);
    doc.removeEventListener("mouseup", onMouseUp);
  }

  function destroy(): void {
    dragging = false;
    anchorNode = null;
    if (syncTimer !== null) clearTimeout(syncTimer);
    doc.removeEventListener("mousemove", onMouseMove);
    doc.removeEventListener("mouseup", onMouseUp);
  }

  return { onMouseDown, destroy };
}
