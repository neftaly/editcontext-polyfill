const KEYBOARD_EVENT_PROPS = [
  "key",
  "code",
  "location",
  "ctrlKey",
  "shiftKey",
  "altKey",
  "metaKey",
  "repeat",
  "isComposing",
] as const;

export function createForwardedKeyboardEvent(event: KeyboardEvent): KeyboardEvent {
  const init: KeyboardEventInit = {};
  for (const prop of KEYBOARD_EVENT_PROPS) {
    (init as Record<string, unknown>)[prop] = event[prop];
  }
  init.bubbles = true;
  init.cancelable = true;
  init.composed = true;
  return new KeyboardEvent(event.type, init);
}

export function dispatchForwardedKeyboardEvent(target: EventTarget, event: KeyboardEvent): boolean {
  return target.dispatchEvent(createForwardedKeyboardEvent(event));
}

export function createForwardedClipboardEvent(event: ClipboardEvent): ClipboardEvent {
  return new ClipboardEvent(event.type, {
    bubbles: true,
    cancelable: event.cancelable,
    composed: true,
    clipboardData: event.clipboardData,
  });
}

export function dispatchForwardedClipboardEvent(
  target: EventTarget,
  event: ClipboardEvent,
): boolean {
  return target.dispatchEvent(createForwardedClipboardEvent(event));
}
