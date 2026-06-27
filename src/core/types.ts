export interface EditContextState {
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly composing: boolean;
  /** True when non-IME input interrupted an active composition. */
  readonly compositionSuspended: boolean;
  readonly compositionRangeStart: number;
  readonly compositionRangeEnd: number;
}

export interface EditContextStateInit {
  readonly text?: string;
  readonly selectionStart?: number;
  readonly selectionEnd?: number;
}

export type EditContextEffect =
  | {
      readonly type: "textupdate";
      readonly text: string;
      readonly updateRangeStart: number;
      readonly updateRangeEnd: number;
      readonly selectionStart: number;
      readonly selectionEnd: number;
    }
  | { readonly type: "compositionstart"; readonly data: string }
  | { readonly type: "compositionend"; readonly data: string };

export interface EditContextTransition {
  readonly state: EditContextState;
  readonly effects: readonly EditContextEffect[];
}
