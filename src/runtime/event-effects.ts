import type { EditContextEffect, EditContextState } from "../edit-context-state.js";
import {
  CharacterBoundsUpdateEventPolyfill,
  TextFormatPolyfill,
  TextFormatUpdateEventPolyfill,
  TextUpdateEventPolyfill,
} from "../event-types.js";

export function dispatchEditContextEffect(target: EventTarget, effect: EditContextEffect): void {
  switch (effect.type) {
    case "textupdate":
      target.dispatchEvent(
        new TextUpdateEventPolyfill("textupdate", {
          text: effect.text,
          updateRangeStart: effect.updateRangeStart,
          updateRangeEnd: effect.updateRangeEnd,
          selectionStart: effect.selectionStart,
          selectionEnd: effect.selectionEnd,
        }),
      );
      break;
    case "compositionstart":
      dispatchCompositionEndOrStart(target, "compositionstart", effect.data);
      break;
    case "compositionend":
      dispatchEmptyTextFormatUpdate(target);
      dispatchCompositionEndOrStart(target, "compositionend", effect.data);
      break;
  }
}

export function dispatchCompositionEnd(target: EventTarget, data: string): void {
  dispatchEmptyTextFormatUpdate(target);
  dispatchCompositionEndOrStart(target, "compositionend", data);
}

function dispatchEmptyTextFormatUpdate(target: EventTarget): void {
  target.dispatchEvent(
    new TextFormatUpdateEventPolyfill("textformatupdate", {
      textFormats: [],
    }),
  );
}

export function dispatchDefaultCompositionFormatRequests(
  target: EventTarget,
  state: EditContextState,
): void {
  if (!state.composing || state.compositionSuspended) return;

  const rangeStart = state.compositionRangeStart;
  const rangeEnd = state.compositionRangeEnd;
  if (rangeEnd <= rangeStart) return;

  target.dispatchEvent(
    new TextFormatUpdateEventPolyfill("textformatupdate", {
      textFormats: [
        new TextFormatPolyfill({
          rangeStart,
          rangeEnd,
          underlineStyle: "solid",
          underlineThickness: "thin",
        }),
      ],
    }),
  );
  target.dispatchEvent(
    new CharacterBoundsUpdateEventPolyfill("characterboundsupdate", {
      rangeStart,
      rangeEnd,
    }),
  );
}

function dispatchCompositionEndOrStart(
  target: EventTarget,
  type: "compositionstart" | "compositionend",
  data: string,
): void {
  target.dispatchEvent(new CompositionEvent(type, { data }));
}
