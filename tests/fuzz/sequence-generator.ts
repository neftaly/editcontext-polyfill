import { mulberry32, type FuzzAction } from "./helpers.js";

const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789 .,";

const EXEC_COMMANDS = ["insertText", "bold", "italic", "delete", "forwardDelete", "selectAll"];

interface TrackedState {
  attached: boolean;
  focused: boolean;
  textLength: number; // approximate — may drift from reality
}

export function generateSequence(seed: number, length: number): FuzzAction[] {
  const rng = mulberry32(seed);
  const actions: FuzzAction[] = [];
  const state: TrackedState = { attached: true, focused: true, textLength: 0 };

  for (let i = 0; i < length; i++) {
    const action = pickAction(rng, state);
    actions.push(action);
    applyToTrackedState(state, action);
  }

  return actions;
}

interface MultiTrackedState {
  attached: boolean;
  focusedTarget: 0 | 1 | 2; // 0 = neither/other, 1 = target1, 2 = target2
  textLength1: number;
  textLength2: number;
}

export function generateMultiSequence(seed: number, length: number): FuzzAction[] {
  const rng = mulberry32(seed);
  const actions: FuzzAction[] = [];
  const state: MultiTrackedState = {
    attached: true,
    focusedTarget: 1,
    textLength1: 0,
    textLength2: 0,
  };

  for (let i = 0; i < length; i++) {
    const action = pickMultiAction(rng, state);
    actions.push(action);
    applyToMultiTrackedState(state, action);
  }

  return actions;
}

function randomString(rng: () => number, maxLen: number): string {
  const len = Math.floor(rng() * maxLen) + 1;
  let s = "";
  for (let i = 0; i < len; i++) {
    s += CHARS[Math.floor(rng() * CHARS.length)];
  }
  return s;
}

function randomInt(rng: () => number, max: number): number {
  return Math.floor(rng() * (max + 1));
}

const ARROW_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const;
const NAV_KEYS = ["Home", "End", "PageUp", "PageDown"] as const;
const BOUNDS_METHODS = [
  "updateSelectionBounds",
  "updateControlBounds",
  "updateCharacterBounds",
] as const;

function randomRect(rng: () => number): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.floor(rng() * 500),
    y: Math.floor(rng() * 500),
    width: Math.floor(rng() * 200) + 10,
    height: Math.floor(rng() * 50) + 10,
  };
}

function pickAction(rng: () => number, state: TrackedState): FuzzAction {
  // Detached: only reattach
  if (!state.attached) {
    return { type: "reattach" };
  }

  // Attached but not focused: limited actions
  if (!state.focused) {
    const r = rng();
    if (r < 0.4) return { type: "focus" };
    if (r < 0.55) return { type: "mouseClick", detail: 1 }; // real click to refocus
    if (r < 0.7) {
      return {
        type: "updateText",
        start: randomInt(rng, state.textLength),
        end: randomInt(rng, state.textLength),
        text: randomString(rng, 4),
      };
    }
    if (r < 0.85) {
      return {
        type: "updateSelection",
        start: randomInt(rng, state.textLength),
        end: randomInt(rng, state.textLength),
      };
    }
    return { type: "detach" };
  }

  // Attached and focused: full vocabulary
  const r = rng();

  // --- Typing & editing (reduced from ~42% to ~35%) ---
  if (r < 0.22) {
    return { type: "type", text: randomString(rng, 4) };
  }
  if (r < 0.35) {
    const keys = ["Backspace", "Delete"];
    return { type: "press", key: keys[Math.floor(rng() * keys.length)] };
  }
  if (r < 0.43) {
    const combos: Array<{ key: string; modifier: string }> = [
      { key: "Backspace", modifier: "Control" },
      { key: "Delete", modifier: "Control" },
      { key: "Enter", modifier: "Shift" },
    ];
    return { type: "pressCombo", ...combos[Math.floor(rng() * combos.length)] };
  }

  // --- Programmatic state updates (~10%) ---
  if (r < 0.48) {
    return {
      type: "updateText",
      start: randomInt(rng, state.textLength),
      end: randomInt(rng, state.textLength),
      text: randomString(rng, 4),
    };
  }
  if (r < 0.53) {
    return {
      type: "updateSelection",
      start: randomInt(rng, state.textLength),
      end: randomInt(rng, state.textLength),
    };
  }

  // --- Clipboard & execCommand (~8%) ---
  if (r < 0.57) {
    return { type: "paste", text: randomString(rng, 6) };
  }
  if (r < 0.61) {
    const cmd = EXEC_COMMANDS[Math.floor(rng() * EXEC_COMMANDS.length)];
    const value = cmd === "insertText" ? randomString(rng, 4) : undefined;
    return { type: "execCommand", command: cmd, value };
  }

  // --- Cursor/navigation keys (~10% combined) ---
  if (r < 0.65) {
    const key = ARROW_KEYS[Math.floor(rng() * ARROW_KEYS.length)];
    return { type: "pressArrow", key };
  }
  if (r < 0.68) {
    const key = NAV_KEYS[Math.floor(rng() * NAV_KEYS.length)];
    return { type: "pressNav", key };
  }
  if (r < 0.71) {
    const key = ARROW_KEYS[Math.floor(rng() * ARROW_KEYS.length)];
    return { type: "pressShiftArrow", key };
  }

  // --- selectAll, cut, undo, redo (~3% each = 12%) ---
  if (r < 0.74) return { type: "selectAll" };
  if (r < 0.77) return { type: "cut" };
  if (r < 0.8) return { type: "undo" };
  if (r < 0.83) return { type: "redo" };

  // --- pressEnter, rapidType, updateBounds (~3% + 3% + 2% = 8%) ---
  if (r < 0.86) return { type: "pressEnter" };
  if (r < 0.89) {
    // Rapid type: 8-16 characters in one go
    const len = Math.floor(rng() * 9) + 8;
    let s = "";
    for (let i = 0; i < len; i++) {
      s += CHARS[Math.floor(rng() * CHARS.length)];
    }
    return { type: "rapidType", text: s };
  }
  if (r < 0.91) {
    const method = BOUNDS_METHODS[Math.floor(rng() * BOUNDS_METHODS.length)];
    const rect = randomRect(rng);
    if (method === "updateCharacterBounds") {
      const count = Math.floor(rng() * 4) + 1;
      const characterBounds = Array.from({ length: count }, () => randomRect(rng));
      return {
        type: "updateBounds",
        method,
        rect,
        rangeStart: randomInt(rng, state.textLength),
        characterBounds,
      };
    }
    return { type: "updateBounds", method, rect };
  }

  // --- Focus/blur/detach (~9%) ---
  if (r < 0.92) return { type: "click" };
  if (r < 0.94) return { type: "blur" };
  if (r < 0.95) return { type: "focusOther" };
  if (r < 0.96) return { type: "clickEmpty" };
  if (r < 0.97) return { type: "tabAway" };
  if (r < 0.98) {
    const detail = rng() < 0.7 ? 1 : rng() < 0.7 ? 2 : 3;
    return { type: "mouseClick", detail };
  }
  if (r < 0.99) return { type: "detach" };
  return { type: "focus" }; // re-focus (sometimes a no-op)
}

function pickMultiAction(rng: () => number, state: MultiTrackedState): FuzzAction {
  // Not focused on any target: switch to one
  if (state.focusedTarget === 0) {
    const r = rng();
    if (r < 0.4) return { type: "focusTarget1" };
    if (r < 0.8) return { type: "focusTarget2" };
    return { type: "focusOther" };
  }

  const textLength = state.focusedTarget === 1 ? state.textLength1 : state.textLength2;

  const r = rng();

  if (r < 0.25) {
    return { type: "type", text: randomString(rng, 4) };
  }
  if (r < 0.35) {
    const keys = ["Backspace", "Delete"];
    return { type: "press", key: keys[Math.floor(rng() * keys.length)] };
  }
  if (r < 0.45) {
    return {
      type: "updateText",
      start: randomInt(rng, textLength),
      end: randomInt(rng, textLength),
      text: randomString(rng, 4),
    };
  }
  if (r < 0.55) {
    return {
      type: "updateSelection",
      start: randomInt(rng, textLength),
      end: randomInt(rng, textLength),
    };
  }
  if (r < 0.7) return { type: "focusTarget1" };
  if (r < 0.85) return { type: "focusTarget2" };
  if (r < 0.92) return { type: "blur" };
  return { type: "focusOther" };
}

function applyToTrackedState(state: TrackedState, action: FuzzAction): void {
  switch (action.type) {
    case "type":
      state.textLength += action.text.length;
      break;
    case "rapidType":
      state.textLength += action.text.length;
      break;
    case "press":
      if (state.textLength > 0) state.textLength = Math.max(0, state.textLength - 1);
      break;
    case "pressCombo":
      // Word deletion removes ~3-5 chars
      state.textLength = Math.max(0, state.textLength - 4);
      break;
    case "updateText": {
      const s = Math.min(action.start, action.end);
      const e = Math.max(action.start, action.end);
      const removed = Math.min(e, state.textLength) - Math.min(s, state.textLength);
      state.textLength = Math.max(0, state.textLength + action.text.length - removed);
      break;
    }
    case "detach":
      state.attached = false;
      state.focused = false;
      state.textLength = 0;
      break;
    case "reattach":
      state.attached = true;
      state.focused = false;
      state.textLength = 0;
      break;
    case "focus":
    case "click":
    case "mouseClick":
      state.focused = true;
      break;
    case "blur":
    case "focusOther":
    case "clickEmpty":
    case "tabAway":
      state.focused = false;
      break;
    // Navigation keys, selection, clipboard, undo/redo, enter, and bounds
    // updates are all no-ops on tracked state — they fire events but don't
    // change EditContext's text/selection from the fuzzer's perspective.
    case "pressArrow":
    case "pressNav":
    case "pressShiftArrow":
    case "selectAll":
    case "pressEnter":
    case "cut":
    case "undo":
    case "redo":
    case "updateBounds":
      break;
    // paste and execCommand don't change tracked state — EditContext doesn't
    // handle them directly (app must), so textLength stays approximate.
  }
}

// -- IME composition sequence generator --

const KANA_CHARS =
  "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん";

interface ImeTrackedState {
  attached: boolean;
  focused: boolean;
  composing: boolean;
  textLength: number;
}

export function generateImeSequence(seed: number, length: number): FuzzAction[] {
  const rng = mulberry32(seed);
  const actions: FuzzAction[] = [];
  const state: ImeTrackedState = { attached: true, focused: true, composing: false, textLength: 0 };

  for (let i = 0; i < length; i++) {
    const action = pickImeAction(rng, state);
    actions.push(action);
    applyToImeTrackedState(state, action);
  }

  return actions;
}

function randomKana(rng: () => number, maxLen: number): string {
  const len = Math.floor(rng() * maxLen) + 1;
  let s = "";
  for (let i = 0; i < len; i++) {
    s += KANA_CHARS[Math.floor(rng() * KANA_CHARS.length)];
  }
  return s;
}

function pickImeAction(rng: () => number, state: ImeTrackedState): FuzzAction {
  if (!state.attached) {
    return { type: "reattach" };
  }

  if (!state.focused) {
    const r = rng();
    if (r < 0.7) return { type: "focus" };
    if (r < 0.85) {
      return {
        type: "updateText",
        start: randomInt(rng, state.textLength),
        end: randomInt(rng, state.textLength),
        text: randomString(rng, 4),
      };
    }
    return {
      type: "updateSelection",
      start: randomInt(rng, state.textLength),
      end: randomInt(rng, state.textLength),
    };
  }

  // Focused and composing
  if (state.composing) {
    const r = rng();
    if (r < 0.4) {
      // Extend/update composition
      const text = randomKana(rng, 4);
      return {
        type: "imeSetComposition",
        text,
        selectionStart: text.length,
        selectionEnd: text.length,
      };
    }
    if (r < 0.7) {
      // Commit
      return { type: "imeCommitText", text: randomKana(rng, 3) };
    }
    if (r < 0.85) {
      // Cancel
      return { type: "imeCancelComposition" };
    }
    // Interruption — blur or type during composition
    if (r < 0.93) return { type: "blur" };
    return { type: "type", text: randomString(rng, 2) };
  }

  // Focused, not composing
  const r = rng();
  if (r < 0.1) {
    // Start composition
    const text = randomKana(rng, 2);
    return {
      type: "imeSetComposition",
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    };
  }
  // Delegate to regular actions for the rest
  const trackedState: TrackedState = {
    attached: state.attached,
    focused: state.focused,
    textLength: state.textLength,
  };
  return pickAction(rng, trackedState);
}

function applyToImeTrackedState(state: ImeTrackedState, action: FuzzAction): void {
  switch (action.type) {
    case "imeSetComposition":
      state.composing = true;
      break;
    case "imeCommitText":
      state.composing = false;
      state.textLength += action.text.length;
      break;
    case "imeCancelComposition":
      state.composing = false;
      break;
    case "blur":
    case "focusOther":
    case "clickEmpty":
    case "tabAway":
      state.composing = false;
      state.focused = false;
      break;
    case "focus":
    case "click":
    case "mouseClick":
      state.focused = true;
      break;
    case "detach":
      state.attached = false;
      state.focused = false;
      state.composing = false;
      state.textLength = 0;
      break;
    case "reattach":
      state.attached = true;
      state.focused = false;
      state.composing = false;
      state.textLength = 0;
      break;
    case "type":
      state.composing = false;
      state.textLength += action.text.length;
      break;
    case "rapidType":
      state.composing = false;
      state.textLength += action.text.length;
      break;
    case "press":
      state.composing = false;
      if (state.textLength > 0) state.textLength = Math.max(0, state.textLength - 1);
      break;
    case "pressCombo":
      state.composing = false;
      state.textLength = Math.max(0, state.textLength - 4);
      break;
    case "updateText": {
      const s = Math.min(action.start, action.end);
      const e = Math.max(action.start, action.end);
      const removed = Math.min(e, state.textLength) - Math.min(s, state.textLength);
      state.textLength = Math.max(0, state.textLength + action.text.length - removed);
      break;
    }
    // Navigation keys, selection, clipboard, undo/redo, enter, and bounds
    // updates are no-ops on tracked state.
    case "pressArrow":
    case "pressNav":
    case "pressShiftArrow":
    case "selectAll":
    case "pressEnter":
    case "cut":
    case "undo":
    case "redo":
    case "updateBounds":
      break;
  }
}

function applyToMultiTrackedState(state: MultiTrackedState, action: FuzzAction): void {
  switch (action.type) {
    case "type":
      if (state.focusedTarget === 1) state.textLength1 += action.text.length;
      if (state.focusedTarget === 2) state.textLength2 += action.text.length;
      break;
    case "rapidType":
      if (state.focusedTarget === 1) state.textLength1 += action.text.length;
      if (state.focusedTarget === 2) state.textLength2 += action.text.length;
      break;
    case "press":
      if (state.focusedTarget === 1) state.textLength1 = Math.max(0, state.textLength1 - 1);
      if (state.focusedTarget === 2) state.textLength2 = Math.max(0, state.textLength2 - 1);
      break;
    case "updateText": {
      const s = Math.min(action.start, action.end);
      const e = Math.max(action.start, action.end);
      if (state.focusedTarget === 1) {
        const removed = Math.min(e, state.textLength1) - Math.min(s, state.textLength1);
        state.textLength1 = Math.max(0, state.textLength1 + action.text.length - removed);
      }
      if (state.focusedTarget === 2) {
        const removed = Math.min(e, state.textLength2) - Math.min(s, state.textLength2);
        state.textLength2 = Math.max(0, state.textLength2 + action.text.length - removed);
      }
      break;
    }
    case "focusTarget1":
      state.focusedTarget = 1;
      break;
    case "focusTarget2":
      state.focusedTarget = 2;
      break;
    case "blur":
    case "focusOther":
    case "clickEmpty":
    case "tabAway":
      state.focusedTarget = 0;
      break;
    // Navigation keys, selection, clipboard, undo/redo, enter, and bounds
    // updates are no-ops on tracked state.
    case "pressArrow":
    case "pressNav":
    case "pressShiftArrow":
    case "selectAll":
    case "pressEnter":
    case "cut":
    case "undo":
    case "redo":
    case "updateBounds":
      break;
  }
}
