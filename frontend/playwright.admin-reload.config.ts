import { defineConfig } from '@playwright/test';
import integrated from './playwright.integrated.config';

const run = process.env.ADMIN_RELOAD_RUN ?? 'current';
export default defineConfig({
  ...integrated,
  testMatch: 'admin-offline-reload.spec.ts',
  timeout: 30_000,
  globalTimeout: 60_000,
  outputDir: `../docs/pilot/admin-reload-debug/${run}/artifacts`,
  reporter: [
    ['line'],
    ['json', { outputFile: `../docs/pilot/admin-reload-debug/${run}/results.json` }],
  ],
  use: { ...integrated.use, trace: 'on', screenshot: 'off' },
});
