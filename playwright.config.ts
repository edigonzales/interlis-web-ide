import { defineConfig, devices } from "@playwright/test";

const previewCommand = "pnpm preview --host 127.0.0.1 --port 4173 --strictPort";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html"], ["github"]] : "line",
  use: {
    baseURL: "http://127.0.0.1:4173/interlis-web-ide/",
    trace: "retain-on-failure",
    serviceWorkers: "allow",
  },
  webServer: {
    command:
      process.env.PLAYWRIGHT_PREBUILT === "1"
        ? previewCommand
        : `pnpm build && ${previewCommand}`,
    url: "http://127.0.0.1:4173/interlis-web-ide/",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
