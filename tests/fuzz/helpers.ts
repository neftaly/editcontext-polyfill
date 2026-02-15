import type { CDPSession, Page } from "@playwright/test";

// Script to delete native EditContext globals so the polyfill installs itself.
export const DELETE_NATIVE_EDIT_CONTEXT = `
  delete window.EditContext;
  delete window.TextUpdateEvent;
  delete window.TextFormatUpdateEvent;
  delete window.CharacterBoundsUpdateEvent;
  delete window.TextFormat;
`;

// Make focus/blur getter-only on HTMLElement.prototype, simulating environments
// (e.g. Firefox) where these are non-writable inherited properties.
export const FREEZE_FOCUS_BLUR = `
  for (const method of ['focus', 'blur']) {
    const original = HTMLElement.prototype[method];
    Object.defineProperty(HTMLElement.prototype, method, {
      get() { return original; },
      configurable: true,
    });
  }
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
  | { type: "mouseClick"; detail: number } // real mouse click on editor (detail: 1=single, 2=double, 3=triple)
  | { type: "clickEmpty" } // real mouse click on empty page space
  | { type: "tabAway" } // press Tab to move focus to next element
  | { type: "detach" }
  | { type: "reattach" }
  | { type: "focus" }
  | { type: "blur" }
  | { type: "focusOther" }
  | { type: "focusTarget1" }
  | { type: "focusTarget2" }
  | { type: "pressArrow"; key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" }
  | { type: "pressNav"; key: "Home" | "End" | "PageUp" | "PageDown" }
  | { type: "pressShiftArrow"; key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" }
  | { type: "selectAll" }
  | { type: "pressEnter" }
  | { type: "cut" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "rapidType"; text: string }
  | {
      type: "updateBounds";
      method: "updateSelectionBounds" | "updateControlBounds" | "updateCharacterBounds";
      rect: { x: number; y: number; width: number; height: number };
      rangeStart?: number;
      characterBounds?: Array<{ x: number; y: number; width: number; height: number }>;
    }
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

export interface TextFormatEntry {
  textFormats: Array<{
    rangeStart: number;
    rangeEnd: number;
    underlineStyle: string;
    underlineThickness: string;
  }>;
}

export interface CharacterBoundsUpdateEntry {
  rangeStart: number;
  rangeEnd: number;
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
    case "mouseClick":
      return `mouseClick(detail=${action.detail})`;
    case "clickEmpty":
      return "clickEmpty()";
    case "tabAway":
      return "tabAway()";
    case "pressArrow":
      return `pressArrow(${action.key})`;
    case "pressNav":
      return `pressNav(${action.key})`;
    case "pressShiftArrow":
      return `pressShiftArrow(${action.key})`;
    case "selectAll":
      return "selectAll()";
    case "pressEnter":
      return "pressEnter()";
    case "cut":
      return "cut()";
    case "undo":
      return "undo()";
    case "redo":
      return "redo()";
    case "rapidType":
      return `rapidType(${JSON.stringify(action.text)})`;
    case "updateBounds":
      return `updateBounds(${action.method})`;
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
    case "mouseClick": {
      // Real mouse click on the editor element — exercises the mousedown handler,
      // preventDefault, activate(), and mouseHandler.onMouseDown() code paths.
      const box = await page.evaluate(() => {
        const el = (window as any).__el as HTMLElement;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      if (action.detail === 1) {
        await page.mouse.click(x, y);
      } else if (action.detail === 2) {
        await page.mouse.dblclick(x, y);
      } else {
        // Triple click: 3 rapid clicks
        await page.mouse.click(x, y, { clickCount: 3 });
      }
      break;
    }
    case "clickEmpty":
      // Real mouse click on empty page space — blur without focusin firing.
      // Exercises the refocus path where activeBinding persists but textarea
      // has lost focus. Click well below all fuzz test content.
      await page.mouse.click(5, 400);
      break;
    case "tabAway":
      // Tab to move focus to the next focusable element.
      // Exercises the tabbing flag logic in focus-manager.
      await page.keyboard.press("Tab");
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
    case "pressArrow":
      await page.keyboard.press(action.key);
      break;
    case "pressNav":
      await page.keyboard.press(action.key);
      break;
    case "pressShiftArrow":
      await page.keyboard.press(`Shift+${action.key}`);
      break;
    case "selectAll":
      await page.keyboard.press("Control+a");
      break;
    case "pressEnter":
      await page.keyboard.press("Enter");
      break;
    case "cut":
      await page.keyboard.press("Control+x");
      break;
    case "undo":
      await page.keyboard.press("Control+z");
      break;
    case "redo":
      await page.keyboard.press("Control+y");
      break;
    case "rapidType":
      await page.keyboard.type(action.text);
      break;
    case "updateBounds":
      await page.evaluate(
        ([method, rect, rangeStart, characterBounds]) => {
          const ec = (window as any).__ec;
          if (!ec) return;
          if (method === "updateSelectionBounds") {
            ec.updateSelectionBounds(new DOMRect(rect.x, rect.y, rect.width, rect.height));
          } else if (method === "updateControlBounds") {
            ec.updateControlBounds(new DOMRect(rect.x, rect.y, rect.width, rect.height));
          } else if (method === "updateCharacterBounds") {
            const bounds = (characterBounds as typeof action.characterBounds)!.map(
              (b) => new DOMRect(b.x, b.y, b.width, b.height),
            );
            ec.updateCharacterBounds(rangeStart as number, bounds);
          }
        },
        [
          action.method,
          action.rect,
          action.rangeStart ?? 0,
          action.characterBounds ?? [action.rect],
        ] as const,
      );
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

  ec.addEventListener("compositionstart", ((e: CompositionEvent) => {
    (window as any).__compositionEvents.push({ type: "compositionstart", data: e.data });
  }) as EventListener);
  ec.addEventListener("compositionend", ((e: CompositionEvent) => {
    (window as any).__compositionEvents.push({ type: "compositionend", data: e.data });
  }) as EventListener);
  ec.addEventListener("textformatupdate", ((e: any) => {
    const formats = e.getTextFormats().map((f: any) => ({
      rangeStart: f.rangeStart,
      rangeEnd: f.rangeEnd,
      underlineStyle: f.underlineStyle,
      underlineThickness: f.underlineThickness,
    }));
    (window as any).__textFormatEvents.push({ textFormats: formats });
  }) as EventListener);
  ec.addEventListener("characterboundsupdate", ((e: any) => {
    (window as any).__characterBoundsUpdateEvents.push({
      rangeStart: e.rangeStart,
      rangeEnd: e.rangeEnd,
    });
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
    (window as any).__textFormatEvents = [];
    (window as any).__characterBoundsUpdateEvents = [];
  });
  await page.evaluate(initListeners);
  await page.evaluate(initCompositionListeners);
}

export async function getCompositionLog(page: Page): Promise<CompositionEntry[]> {
  return page.evaluate(() => (window as any).__compositionEvents ?? []);
}

export async function getTextFormatLog(page: Page): Promise<TextFormatEntry[]> {
  return page.evaluate(() => (window as any).__textFormatEvents ?? []);
}

export async function getCharacterBoundsUpdateLog(
  page: Page,
): Promise<CharacterBoundsUpdateEntry[]> {
  return page.evaluate(() => (window as any).__characterBoundsUpdateEvents ?? []);
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
