import { EditContextPolyfill } from "./edit-context.js";
import {
  TextUpdateEventPolyfill,
  TextFormatUpdateEventPolyfill,
  CharacterBoundsUpdateEventPolyfill,
  TextFormatPolyfill,
} from "./event-types.js";
import { installEditContextProperty, uninstallEditContextProperty } from "./element-binding.js";
import { destroyAllBindings } from "./focus-manager.js";
import {
  installExecCommandInterceptor,
  uninstallExecCommandInterceptor,
} from "./exec-command-interceptor.js";
import { installSelectionRenderer, uninstallSelectionRenderer } from "./selection-renderer.js";

const POLYFILL_GLOBALS: Record<string, unknown> = {
  EditContext: EditContextPolyfill,
  TextUpdateEvent: TextUpdateEventPolyfill,
  TextFormatUpdateEvent: TextFormatUpdateEventPolyfill,
  CharacterBoundsUpdateEvent: CharacterBoundsUpdateEventPolyfill,
  TextFormat: TextFormatPolyfill,
};

let installed = false;
let previousGlobals: Record<string, unknown> = {};

export interface InstallOptions {
  force?: boolean;
}

export function install(options?: InstallOptions): void {
  if (!options?.force && typeof (globalThis as Record<string, unknown>).EditContext !== "undefined")
    return;
  if (installed) return;

  const g = globalThis as Record<string, unknown>;
  for (const [name, impl] of Object.entries(POLYFILL_GLOBALS)) {
    previousGlobals[name] = g[name];
    g[name] = impl;
  }

  installEditContextProperty();
  installExecCommandInterceptor();
  installSelectionRenderer();
  installed = true;
}

export function uninstall(): void {
  if (!installed) return;

  const g = globalThis as Record<string, unknown>;
  for (const name of Object.keys(POLYFILL_GLOBALS)) {
    if (previousGlobals[name] === undefined) {
      delete g[name];
    } else {
      g[name] = previousGlobals[name];
    }
  }
  previousGlobals = {};

  destroyAllBindings();
  uninstallSelectionRenderer();
  uninstallExecCommandInterceptor();
  uninstallEditContextProperty();
  installed = false;
}
