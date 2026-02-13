import { defineConfig, devices } from "@playwright/test";

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
];

// Firefox/WebKit are a separate compat concern, not part of core testing.
// Run with ALL_BROWSERS=1 (e.g. inside `docker run`) to include them.
if (process.env.ALL_BROWSERS) {
  projects.push({
    name: "firefox-polyfill",
    use: {
      ...devices["Desktop Firefox"],
      serviceWorkers: "block" as const,
    },
  });
  projects.push({
    name: "webkit-polyfill",
    use: {
      ...devices["Desktop Safari"],
      serviceWorkers: "block" as const,
    },
  });
}

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
