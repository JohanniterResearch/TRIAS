import { defineConfig } from '@playwright/test';
import integrated from './playwright.integrated.config';
export default defineConfig({
  ...integrated,
  testMatch: 'field-conflicts.spec.ts',
  outputDir: '../docs/pilot/field-conflicts/real-artifacts',
  reporter: [['line'], ['json', { outputFile: '../docs/pilot/field-conflicts/real-results.json' }]],
  use: { ...integrated.use, trace: 'on' },
});
