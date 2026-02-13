// Wraps document.execCommand and queryCommand* to suppress most commands
// when an EditContext is the active editing host. Chrome blocks all query
// methods (not just queryCommandEnabled) per W3C edit-context issue #71.

import { hasActiveEditContext } from "./focus-manager.js";

let installed = false;
let originalExecCommand: typeof document.execCommand;
let originalQueryCommandEnabled: typeof document.queryCommandEnabled;
let originalQueryCommandSupported: typeof document.queryCommandSupported;
let originalQueryCommandState: typeof document.queryCommandState;
let originalQueryCommandValue: typeof document.queryCommandValue;

// Commands that pass through even when EditContext is active
const PASSTHROUGH_COMMANDS: ReadonlySet<string> = new Set(["copy"]);

export function installExecCommandInterceptor(): void {
  if (installed) return;

  originalExecCommand = document.execCommand.bind(document);
  originalQueryCommandEnabled = document.queryCommandEnabled.bind(document);
  originalQueryCommandSupported = document.queryCommandSupported.bind(document);
  originalQueryCommandState = document.queryCommandState.bind(document);
  originalQueryCommandValue = document.queryCommandValue.bind(document);

  document.execCommand = (commandId: string, showUI?: boolean, value?: string): boolean => {
    if (!hasActiveEditContext()) return originalExecCommand(commandId, showUI, value);

    if (!PASSTHROUGH_COMMANDS.has(commandId.toLowerCase())) {
      return false;
    }
    return originalExecCommand(commandId, showUI, value);
  };

  document.queryCommandEnabled = (commandId: string): boolean => {
    if (hasActiveEditContext() && !PASSTHROUGH_COMMANDS.has(commandId.toLowerCase())) {
      return false;
    }
    return originalQueryCommandEnabled(commandId);
  };

  document.queryCommandSupported = (commandId: string): boolean => {
    if (hasActiveEditContext() && !PASSTHROUGH_COMMANDS.has(commandId.toLowerCase())) {
      return false;
    }
    return originalQueryCommandSupported(commandId);
  };

  document.queryCommandState = (commandId: string): boolean => {
    if (hasActiveEditContext()) return false;
    return originalQueryCommandState(commandId);
  };

  document.queryCommandValue = (commandId: string): string => {
    if (hasActiveEditContext()) return "";
    return originalQueryCommandValue(commandId);
  };

  installed = true;
}

export function uninstallExecCommandInterceptor(): void {
  if (!installed) return;

  document.execCommand = originalExecCommand;
  document.queryCommandEnabled = originalQueryCommandEnabled;
  document.queryCommandSupported = originalQueryCommandSupported;
  document.queryCommandState = originalQueryCommandState;
  document.queryCommandValue = originalQueryCommandValue;

  installed = false;
}
