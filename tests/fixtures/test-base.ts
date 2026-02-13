import { test as base, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { DELETE_NATIVE_EDIT_CONTEXT } from "../fuzz/helpers.js";

const polyfillSource = fs.readFileSync(path.resolve("dist/editcontext-polyfill.iife.js"), "utf-8");

// Serves HTML via page.route() + page.goto() so that addInitScript fires
// in all browsers (it doesn't fire with page.setContent in Firefox).
async function setContent(page: Page, html: string): Promise<void> {
  const fullHtml = html.startsWith("<!") ? html : `<!DOCTYPE html>${html}`;
  await page.route("https://example.com/**", (route) => {
    route.fulfill({ contentType: "text/html", body: fullHtml });
  });
  await page.goto("https://example.com/");
}

// Check if this test run should use the polyfill.
// "chromium-polyfill", "firefox-polyfill", "webkit-polyfill" all get it.
function isPolyfillProject(projectName: string): boolean {
  return projectName.includes("polyfill");
}

// Extend base test to inject polyfill for polyfill projects,
// and provide a setContent helper that works across all browsers.
export const test = base.extend<{
  setContent: (html: string) => Promise<void>;
}>({
  page: async ({ page }, use, testInfo) => {
    if (isPolyfillProject(testInfo.project.name)) {
      await page.addInitScript(DELETE_NATIVE_EDIT_CONTEXT);
      await page.addInitScript(polyfillSource);
    }
    await use(page);
  },
  setContent: async ({ page }, use) => {
    await use((html: string) => setContent(page, html));
  },
});

export { expect } from "@playwright/test";
