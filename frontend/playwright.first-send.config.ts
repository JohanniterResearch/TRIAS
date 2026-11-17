import { defineConfig } from '@playwright/test';
import integrated from './playwright.integrated.config';
export default defineConfig({
  ...integrated,
  testMatch: 'clinical-first-send.spec.ts',
  outputDir: '../docs/pilot/first-send/real-artifacts',
  reporter: [['line'], ['json', { outputFile: '../docs/pilot/first-send/real-results.json' }]],
  use: { ...integrated.use, trace: 'on' },
});
