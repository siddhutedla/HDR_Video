// Playwright configuration for the static HDR viewer.
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30 * 1000,
  retries: process.env.CI ? 2 : 0,
  expect: { timeout: 10 * 1000 },
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
  },
  webServer: {
    // Use python3 for portability in CI images
    command: 'python3 -m http.server 4173',
    port: 4173,
    cwd: __dirname,
    timeout: 20000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
});
