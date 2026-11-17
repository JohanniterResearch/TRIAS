import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/integrated',
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  outputDir: '../docs/pilot/acceptance-harness/browser-artifacts',
  reporter: [
    ['line'],
    ['json', { outputFile: '../docs/pilot/acceptance-harness/browser-results.json' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4348',
    browserName: 'chromium',
    channel: 'chrome',
    serviceWorkers: 'allow',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-integrated.mjs',
    url: 'http://127.0.0.1:4348/login',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
