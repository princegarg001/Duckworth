import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration.
 *
 * Runs against a stack that is already up (`make up`, or the compose services
 * in CI). Deliberately no `webServer` block spawning `next dev`: the point of
 * these tests is to exercise the production build behind the real API, not a
 * development server with different caching and error behaviour.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3001',
    // Traces only on a retry: full traces on every run are gigabytes of
    // artifacts nobody opens.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // One mobile viewport: the tables and charts are the things most likely to
    // overflow, and they are on every page.
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
