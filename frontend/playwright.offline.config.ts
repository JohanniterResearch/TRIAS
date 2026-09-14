import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/offline',
  timeout: 30_000,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4300',
    browserName: 'chromium',
    channel: 'chrome',
  },
  webServer: {
    command: 'node scripts/serve-dist.mjs',
    url: 'http://127.0.0.1:4300/login',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
