import type { CDPSession, Page } from "@playwright/test";

// Script to delete native EditContext globals so the polyfill installs itself.
export const DELETE_NATIVE_EDIT_CONTEXT = `
  delete window.EditContext;
  delete window.TextUpdateEvent;
  delete window.TextFormatUpdateEvent;
  delete window.CharacterBoundsUpdateEvent;
  delete window.TextFormat;
`;

// Seeded PRNG (mulberry32)
export function mulberry32(seed: number): () => number {
  return () => {
    seed += 0x6d2b79f5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type FuzzAction =
  | { type: "type"; text: string }
  | { type: "press"; key: string }
  | { type: "pressCombo"; key: string; modifier: string }
  | { type: "updateText"; start: number; end: number; text: string }
  | { type: "updateSelection"; start: number; end: number }
  | { type: "paste"; text: string }
  | { type: "execCommand"; command: string; value?: string }
  | { type: "click" }
  | { type: "detach" }
  | { type: "reattach" }
  | { type: "focus" }
  | { type: "blur" }
  | { type: "focusOther" }
  | { type: "focusTarget1" }
  | { type: "focusTarget2" }
  | { type: "imeSetComposition"; text: string; selectionStart: number; selectionEnd: number }
  | { type: "imeCommitText"; text: string }
  | { type: "imeCancelComposition" };

export interface EditContextState {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface TextUpdateEntry {
  text: string;
  updateRangeStart: number;
  updateRangeEnd: number;
  selectionStart: number;
  selectionEnd: number;
}

export interface BeforeInputEntry {
  inputType: string;
  data: string | null;
}

export interface CompositionEntry {
  type: "compositionstart" | "compositionend";
  data: string;
}

export function formatAction(action: FuzzAction): string {
  switch (action.type) {
    case "type":
      return `type(${JSON.stringify(action.text)})`;
    case "press":
      return `press(${action.key})`;
    case "pressCombo":
      return `press(${action.modifier}+${action.key})`;
    case "updateText":
      return `updateText(${action.start}, ${action.end}, ${JSON.stringify(action.text)})`;
    case "updateSelection":
      return `updateSelection(${action.start}, ${action.end})`;
    case "paste":
      return `paste(${JSON.stringify(action.text)})`;
    case "execCommand":
      return `execCommand(${action.command}${action.value ? `, ${JSON.stringify(action.value)}` : ""})`;
    case "imeSetComposition":
      return `imeSetComposition(${JSON.stringify(action.text)}, ${action.selectionStart}, ${action.selectionEnd})`;
    case "imeCommitText":
      return `imeCommitText(${JSON.stringify(action.text)})`;
    case "imeCancelComposition":
      return "imeCancelComposition()";
    default:
      return action.type;
  }
}

export function formatSequence(actions: FuzzAction[]): string {
  return actions.map((a, i) => `  ${i}: ${formatAction(a)}`).join("\n");
}

// -- Shared page helpers for all fuzzer variants --

/** Set up textupdate + beforeinput listeners on an already-created EditContext. */
function initListeners(): void {
  const ec = (window as any).__ec;
  const el = (window as any).__el;

  ec.addEventListener("textupdate", ((e: TextUpdateEvent) => {
    (window as any).__events.push({
      text: e.text,
      updateRangeStart: e.updateRangeStart,
      updateRangeEnd: e.updateRangeEnd,
      selectionStart: e.selectionStart,
      selectionEnd: e.selectionEnd,
    });
  }) as EventListener);

  el.addEventListener("beforeinput", (e: InputEvent) => {
    (window as any).__beforeInputEvents.push({
      inputType: e.inputType,
      data: e.data,
    });
  });
}

export async function setupEditContext(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.getElementById("target")!;
    const ec = new EditContext();
    el.editContext = ec;
    el.focus();
    (window as any).__ec = ec;
    (window as any).__el = el;
    (window as any).__events = [];
    (window as any).__beforeInputEvents = [];
  });
  await page.evaluate(initListeners);
}

const DEFAULT_ACTION_TIMEOUT = 5000;

/**
 * Execute a fuzz action with a per-action timeout. Returns true if the action
 * completed, false if it timed out (Chrome/Playwright infrastructure hang).
 */
export async function executeActionWithTimeout(
  page: Page,
  action: FuzzAction,
  timeoutMs: number = DEFAULT_ACTION_TIMEOUT,
): Promise<boolean> {
  try {
    await Promise.race([
      executeAction(page, action),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Action timed out")), timeoutMs),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute an IME fuzz action with a per-action timeout. Returns true if the
 * action completed, false if it timed out.
 */
export async function executeImeActionWithTimeout(
  page: Page,
  client: CDPSession,
  action: FuzzAction,
  timeoutMs: number = DEFAULT_ACTION_TIMEOUT,
): Promise<boolean> {
  try {
    await Promise.race([
      executeImeAction(page, client, action),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Action timed out")), timeoutMs),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function executeAction(page: Page, action: FuzzAction): Promise<void> {
  switch (action.type) {
    case "type":
      await page.keyboard.type(action.text);
      break;
    case "press":
      await page.keyboard.press(action.key);
      break;
    case "pressCombo":
      await page.keyboard.press(`${action.modifier}+${action.key}`);
      break;
    case "updateText":
      await page.evaluate(
        ([s, e, t]) => {
          const ec = (window as any).__ec;
          if (ec) ec.updateText(s, e, t);
        },
        [action.start, action.end, action.text] as const,
      );
      break;
    case "updateSelection":
      await page.evaluate(
        ([s, e]) => {
          const ec = (window as any).__ec;
          if (ec) ec.updateSelection(s, e);
        },
        [action.start, action.end] as const,
      );
      break;
    case "paste":
      await page.evaluate((text) => navigator.clipboard.writeText(text), action.text);
      await page.keyboard.press("Control+v");
      break;
    case "execCommand":
      await page.evaluate(([cmd, val]) => document.execCommand(cmd, false, val ?? undefined), [
        action.command,
        action.value ?? null,
      ] as const);
      break;
    case "click":
      // Use the stored __el reference instead of a CSS selector so that this
      // works even when #target is a custom element with a shadow root (where
      // Playwright's CSS selector engine may fail to resolve it).
      await page.evaluate(() => (window as any).__el.click());
      break;
    case "detach":
      await page.evaluate(() => {
        (window as any).__el.editContext = null;
      });
      break;
    case "reattach":
      await page.evaluate(() => {
        const el = (window as any).__el as HTMLElement;
        const ec = new EditContext();
        el.editContext = ec;
        (window as any).__ec = ec;
        (window as any).__events = [];
        (window as any).__beforeInputEvents = [];
      });
      await page.evaluate(initListeners);
      break;
    case "focus":
    case "focusTarget1":
      await page.evaluate(() => (window as any).__el.focus());
      break;
    case "blur":
      await page.evaluate(() => (window as any).__el.blur());
      break;
    case "focusOther":
      await page.evaluate(() => document.getElementById("other")!.focus());
      break;
    case "focusTarget2":
      await page.evaluate(() => document.getElementById("target2")!.focus());
      break;
  }
}

export async function getState(page: Page): Promise<EditContextState | null> {
  return page.evaluate(() => {
    const ec = (window as any).__ec;
    if (!ec) return null;
    return {
      text: ec.text as string,
      selectionStart: ec.selectionStart as number,
      selectionEnd: ec.selectionEnd as number,
    };
  });
}

export async function getEventLog(page: Page): Promise<TextUpdateEntry[]> {
  return page.evaluate(() => (window as any).__events ?? []);
}

export async function getBeforeInputLog(page: Page): Promise<BeforeInputEntry[]> {
  return page.evaluate(() => (window as any).__beforeInputEvents ?? []);
}

export async function getInnerHTML(page: Page): Promise<string> {
  return page.evaluate(() => document.getElementById("target")!.innerHTML);
}

// -- IME composition helpers --

function initCompositionListeners(): void {
  const ec = (window as any).__ec;
  const el = (window as any).__el;

  ec.addEventListener("compositionstart", ((e: CompositionEvent) => {
    (window as any).__compositionEvents.push({ type: "compositionstart", data: e.data });
  }) as EventListener);
  ec.addEventListener("compositionend", ((e: CompositionEvent) => {
    (window as any).__compositionEvents.push({ type: "compositionend", data: e.data });
  }) as EventListener);
}

export async function setupEditContextWithComposition(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.getElementById("target")!;
    const ec = new EditContext();
    el.editContext = ec;
    el.focus();
    (window as any).__ec = ec;
    (window as any).__el = el;
    (window as any).__events = [];
    (window as any).__beforeInputEvents = [];
    (window as any).__compositionEvents = [];
  });
  await page.evaluate(initListeners);
  await page.evaluate(initCompositionListeners);
}

export async function getCompositionLog(page: Page): Promise<CompositionEntry[]> {
  return page.evaluate(() => (window as any).__compositionEvents ?? []);
}

export async function executeImeAction(
  page: Page,
  client: CDPSession,
  action: FuzzAction,
): Promise<void> {
  switch (action.type) {
    case "imeSetComposition":
      await client.send("Input.imeSetComposition", {
        text: action.text,
        selectionStart: action.selectionStart,
        selectionEnd: action.selectionEnd,
      });
      break;
    case "imeCommitText":
      await client.send("Input.insertText", { text: action.text });
      break;
    case "imeCancelComposition":
      await client.send("Input.imeSetComposition", {
        text: "",
        selectionStart: 0,
        selectionEnd: 0,
      });
      break;
    default:
      await executeAction(page, action);
  }
}
