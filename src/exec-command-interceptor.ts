// Wraps document.execCommand and queryCommand* to suppress most commands
// when an EditContext is the active editing host.

import { hasActiveEditContext } from "./focus-manager.js";

const PASSTHROUGH_COMMANDS: ReadonlySet<string> = new Set(["copy"]);
const COMMAND_NAMES = [
  "execCommand",
  "queryCommandEnabled",
  "queryCommandSupported",
  "queryCommandState",
  "queryCommandValue",
] as const;

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous document command signatures
type AnyFn = (...args: any[]) => any;
type DocCommands = Record<string, AnyFn>;

let originals: DocCommands | null = null;

export function installExecCommandInterceptor(): void {
  if (originals) return;

  originals = Object.fromEntries(
    COMMAND_NAMES.map((name) => [name, (document as unknown as DocCommands)[name].bind(document)]),
  );

  document.execCommand = (commandId: string, showUI?: boolean, value?: string): boolean => {
    if (hasActiveEditContext() && !PASSTHROUGH_COMMANDS.has(commandId.toLowerCase())) return false;
    return originals!.execCommand(commandId, showUI, value);
  };

  for (const name of ["queryCommandEnabled", "queryCommandSupported"] as const) {
    (document as unknown as DocCommands)[name] = (commandId: string): boolean => {
      if (hasActiveEditContext() && !PASSTHROUGH_COMMANDS.has(commandId.toLowerCase()))
        return false;
      return originals![name](commandId);
    };
  }

  document.queryCommandState = (commandId: string): boolean => {
    return hasActiveEditContext() ? false : originals!.queryCommandState(commandId);
  };

  document.queryCommandValue = (commandId: string): string => {
    return hasActiveEditContext() ? "" : originals!.queryCommandValue(commandId);
  };
}

export function uninstallExecCommandInterceptor(): void {
  if (!originals) return;
  for (const [name, fn] of Object.entries(originals)) {
    (document as unknown as DocCommands)[name] = fn;
  }
  originals = null;
}
