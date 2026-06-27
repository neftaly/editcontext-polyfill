// Shadow DOM adapter for hosts that can contain the hidden textarea.
// Keeps the attachment/fallback decision in one place.

const shadowRoots = new WeakMap<HTMLElement, ShadowRoot>();

/**
 * Ensure the host has a shadow root with a <slot> for light DOM children.
 * Returns the shadow root, or null when the host cannot be shadow-backed.
 */
export function ensureShadowRoot(host: HTMLElement): ShadowRoot | null {
  const existing = shadowRoots.get(host);
  if (existing) return existing;

  if (host.shadowRoot) {
    shadowRoots.set(host, host.shadowRoot);
    return host.shadowRoot;
  }

  try {
    const shadow = host.attachShadow({ mode: "open" });
    shadow.appendChild(host.ownerDocument.createElement("slot"));
    shadowRoots.set(host, shadow);
    return shadow;
  } catch {
    return null;
  }
}

export function getShadowRoot(host: HTMLElement): ShadowRoot | null {
  return shadowRoots.get(host) ?? host.shadowRoot;
}

export function hasShadowRoot(host: HTMLElement): boolean {
  return getShadowRoot(host) !== null;
}

export function isShadowRootNode(node: Node): node is ShadowRoot {
  const ownerDocument =
    node.nodeType === Node.DOCUMENT_NODE ? (node as Document) : node.ownerDocument;
  const view = ownerDocument?.defaultView;
  return !!view?.ShadowRoot && node instanceof view.ShadowRoot;
}

export function isInShadowTree(node: Node): boolean {
  return isShadowRootNode(node.getRootNode());
}
