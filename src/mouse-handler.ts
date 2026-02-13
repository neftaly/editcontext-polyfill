// Handles mouse interactions (click-to-position, drag selection, double/triple
// click) for EditContext elements. The polyfill's focus redirection prevents the
// browser from creating native DOM selections on the editor element, so we
// recreate them manually using caretRangeFromPoint/caretPositionFromPoint.
// This triggers selectionchange events so apps work without modification.

export interface MouseHandler {
  onMouseDown(event: MouseEvent): void;
  destroy(): void;
}

/** Get a collapsed Range at the character position under (x, y) viewport coords. */
function caretRangeAt(doc: Document, x: number, y: number): Range | null {
  // Chrome / Safari
  if (doc.caretRangeFromPoint) {
    return doc.caretRangeFromPoint(x, y);
  }
  // Firefox
  const caretPos = (
    doc as {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
    }
  ).caretPositionFromPoint?.(x, y);
  if (caretPos) {
    const range = doc.createRange();
    range.setStart(caretPos.offsetNode, caretPos.offset);
    range.collapse(true);
    return range;
  }
  return null;
}

/** True if position (node1, offset1) is after (node2, offset2) in document order. */
function isAfter(node1: Node, offset1: number, node2: Node, offset2: number): boolean {
  if (node1 === node2) return offset1 > offset2;
  return !!(node1.compareDocumentPosition(node2) & Node.DOCUMENT_POSITION_PRECEDING);
}

/** Collect all text node positions within a host element. */
function collectTextPositions(host: HTMLElement): Array<{ node: Text; offset: number }> {
  const positions: Array<{ node: Text; offset: number }> = [];
  const walker = host.ownerDocument.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    for (let i = 0; i <= textNode.length; i++) {
      positions.push({ node: textNode, offset: i });
    }
  }
  return positions;
}

/** Find the index in positions array matching a DOM position. */
function findPositionIndex(
  positions: Array<{ node: Text; offset: number }>,
  node: Node,
  offset: number,
): number {
  for (let i = 0; i < positions.length; i++) {
    if (positions[i].node === node && positions[i].offset === offset) return i;
  }
  // Fallback: if node is an element, offset means "before the Nth child"
  if (node.nodeType === Node.ELEMENT_NODE && node.childNodes[offset]) {
    const child = node.childNodes[offset];
    for (let i = 0; i < positions.length; i++) {
      if (
        (positions[i].node as Node) === child ||
        (positions[i].node.parentNode as Node | null) === child
      ) {
        return i;
      }
    }
  }
  return 0;
}

/** Expand a collapsed range to the word (non-whitespace run) around the click.
 *  Works across text node boundaries (e.g. per-character <span> elements). */
function expandToWord(range: Range, host: HTMLElement): void {
  const positions = collectTextPositions(host);
  if (positions.length === 0) return;

  // Build full text from unique characters
  let fullText = "";
  const charPositions: Array<{ node: Text; offset: number }> = [];
  for (const pos of positions) {
    if (pos.offset < pos.node.length) {
      fullText += pos.node.data[pos.offset];
      charPositions.push(pos);
    }
  }
  if (charPositions.length === 0) return;

  // Find click position in the full text
  const clickIdx = findPositionIndex(positions, range.startContainer, range.startOffset);
  // Map position index to char index
  let charIdx = 0;
  for (let i = 0; i < positions.length && i < clickIdx; i++) {
    if (positions[i].offset < positions[i].node.length) charIdx++;
  }
  if (charIdx >= fullText.length) charIdx = fullText.length - 1;
  if (charIdx < 0) return;

  // Expand to word boundaries
  let wordStart = charIdx;
  let wordEnd = charIdx;
  while (wordStart > 0 && /\S/.test(fullText[wordStart - 1])) wordStart--;
  while (wordEnd < fullText.length && /\S/.test(fullText[wordEnd])) wordEnd++;
  if (wordStart === wordEnd) return;

  // Map back to DOM positions
  const startPos = charPositions[wordStart];
  const endPos = charPositions[wordEnd - 1];
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset + 1);
}

/** Create a Range spanning from (startNode, startOff) to (endNode, endOff). */
function makeRange(
  doc: Document,
  startNode: Node,
  startOff: number,
  endNode: Node,
  endOff: number,
): Range {
  const r = doc.createRange();
  if (isAfter(startNode, startOff, endNode, endOff)) {
    r.setStart(endNode, endOff);
    r.setEnd(startNode, startOff);
  } else {
    r.setStart(startNode, startOff);
    r.setEnd(endNode, endOff);
  }
  return r;
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

    const range = caretRangeAt(doc, event.clientX, event.clientY);
    if (!range || !host.contains(range.startContainer)) return;

    const sel = doc.getSelection();
    if (!sel) return;

    // Triple+ click: select all text in the host
    if (event.detail >= 3) {
      const walker = doc.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      const firstText = walker.nextNode() as Text | null;
      if (!firstText) return;
      let lastText: Text = firstText;
      while (walker.nextNode()) lastText = walker.currentNode as Text;
      const fullRange = doc.createRange();
      fullRange.setStart(firstText, 0);
      fullRange.setEnd(lastText, lastText.length);
      sel.removeAllRanges();
      sel.addRange(fullRange);
      scheduleSync();
      return;
    }

    // Double click: select word
    if (event.detail === 2) {
      expandToWord(range, host);
      sel.removeAllRanges();
      sel.addRange(range);
      scheduleSync();
      return;
    }

    // Shift+click: extend from current anchor to click point
    if (event.shiftKey && sel.anchorNode && host.contains(sel.anchorNode)) {
      const extRange = makeRange(
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

    const range = caretRangeAt(doc, event.clientX, event.clientY);
    if (!range || !host.contains(range.startContainer)) return;

    const sel = doc.getSelection();
    if (!sel) return;

    const dragRange = makeRange(
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
