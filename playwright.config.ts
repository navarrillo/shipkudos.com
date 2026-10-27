import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://127.0.0.1:3000", headless: true },
  webServer: {
    command: process.env.CI ? "npm start" : "npm run dev",
    url: "http://127.0.0.1:3000/healthz",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
