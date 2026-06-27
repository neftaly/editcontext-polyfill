export function caretRangeAtPoint(doc: Document, x: number, y: number): Range | null {
  if (doc.caretRangeFromPoint) {
    return doc.caretRangeFromPoint(x, y);
  }

  const caretPositionFromPoint = (
    doc as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
    }
  ).caretPositionFromPoint;

  const caretPos = caretPositionFromPoint?.call(doc, x, y);
  if (!caretPos) return null;

  const range = doc.createRange();
  range.setStart(caretPos.offsetNode, caretPos.offset);
  range.collapse(true);
  return range;
}

function showTextFilter(doc: Document): number {
  return doc.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
}

function isDomPositionAfter(node1: Node, offset1: number, node2: Node, offset2: number): boolean {
  if (node1 === node2) return offset1 > offset2;
  return !!(node1.compareDocumentPosition(node2) & Node.DOCUMENT_POSITION_PRECEDING);
}

function collectTextPositions(host: HTMLElement): Array<{ node: Text; offset: number }> {
  const positions: Array<{ node: Text; offset: number }> = [];
  const walker = host.ownerDocument.createTreeWalker(host, showTextFilter(host.ownerDocument));
  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    for (let i = 0; i <= textNode.length; i++) {
      positions.push({ node: textNode, offset: i });
    }
  }
  return positions;
}

function findPositionIndex(
  positions: Array<{ node: Text; offset: number }>,
  node: Node,
  offset: number,
): number {
  for (let i = 0; i < positions.length; i++) {
    if (positions[i].node === node && positions[i].offset === offset) return i;
  }

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

/** Expand a collapsed range to the word around the click. */
export function expandRangeToWord(range: Range, host: HTMLElement): void {
  const positions = collectTextPositions(host);
  if (positions.length === 0) return;

  let fullText = "";
  const charPositions: Array<{ node: Text; offset: number }> = [];
  for (const pos of positions) {
    if (pos.offset < pos.node.length) {
      fullText += pos.node.data[pos.offset];
      charPositions.push(pos);
    }
  }
  if (charPositions.length === 0) return;

  const clickIdx = findPositionIndex(positions, range.startContainer, range.startOffset);
  let charIdx = 0;
  for (let i = 0; i < positions.length && i < clickIdx; i++) {
    if (positions[i].offset < positions[i].node.length) charIdx++;
  }
  if (charIdx >= fullText.length) charIdx = fullText.length - 1;
  if (charIdx < 0) return;

  let wordStart = charIdx;
  let wordEnd = charIdx;
  while (wordStart > 0 && /\S/.test(fullText[wordStart - 1])) wordStart--;
  while (wordEnd < fullText.length && /\S/.test(fullText[wordEnd])) wordEnd++;
  if (wordStart === wordEnd) return;

  const startPos = charPositions[wordStart];
  const endPos = charPositions[wordEnd - 1];
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset + 1);
}

export function createRangeBetween(
  doc: Document,
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number,
): Range {
  const range = doc.createRange();
  if (isDomPositionAfter(startNode, startOffset, endNode, endOffset)) {
    range.setStart(endNode, endOffset);
    range.setEnd(startNode, startOffset);
  } else {
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
  }
  return range;
}

export function createTextContentRange(host: HTMLElement): Range | null {
  const doc = host.ownerDocument;
  const walker = doc.createTreeWalker(host, showTextFilter(doc));
  const firstText = walker.nextNode() as Text | null;
  if (!firstText) return null;

  let lastText: Text = firstText;
  while (walker.nextNode()) lastText = walker.currentNode as Text;

  const range = doc.createRange();
  range.setStart(firstText, 0);
  range.setEnd(lastText, lastText.length);
  return range;
}
