import { defineConfig, devices } from "@playwright/test";

const includeCompatBrowsers = Boolean(process.env.ALL_BROWSERS || process.env.COMPAT_BROWSERS);
const includeFrozenFocus = includeCompatBrowsers || Boolean(process.env.FROZEN_FOCUS_COMPAT);
const includeFirefox = includeCompatBrowsers || Boolean(process.env.FIREFOX_COMPAT);
const includeWebKit = includeCompatBrowsers || Boolean(process.env.WEBKIT_COMPAT);

const projects = [
  {
    name: "chromium-native",
    use: { ...devices["Desktop Chrome"] },
  },
  {
    name: "chromium-polyfill",
    use: {
      ...devices["Desktop Chrome"],
    },
  },
  ...(includeFrozenFocus
    ? [
        {
          name: "chromium-polyfill-frozen-focus",
          use: {
            ...devices["Desktop Chrome"],
          },
        },
      ]
    : []),
  ...(includeFirefox
    ? [
        {
          name: "firefox-polyfill",
          use: {
            ...devices["Desktop Firefox"],
            serviceWorkers: "block" as const,
          },
        },
      ]
    : []),
  ...(includeWebKit
    ? [
        {
          name: "webkit-polyfill",
          use: {
            ...devices["Desktop Safari"],
            serviceWorkers: "block" as const,
          },
        },
      ]
    : []),
];

export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    trace: "on-first-retry",
  },
  projects,
});
