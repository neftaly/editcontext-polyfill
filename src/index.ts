export { install, uninstall } from "./install.js";
export type { InstallOptions } from "./install.js";
export { createEditContext } from "./create-edit-context.js";
export type { CreateEditContextOptions } from "./create-edit-context.js";

import { install } from "./install.js";

// Auto-install when loaded via script tag (IIFE bundle).
// Use <script src="..." data-force> to force the polyfill even when
// native EditContext is available (e.g. Chrome/Edge).
if (typeof window !== "undefined") {
  const force = document.currentScript?.hasAttribute("data-force") ?? false;
  install({ force });
}
