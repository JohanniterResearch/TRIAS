import { defineConfig } from '@playwright/test';

// Runs against the real Ambulanzsystem backend and an isolated PostgreSQL started by
// scripts/run-e2e.sh (own compose project and port, never the developer database on 5434).
const dbHostPort = process.env.DB_HOST_PORT ?? '5436';
const backendPort = process.env.PLS_E2E_BACKEND_PORT ?? '5043';
const frontendPort = process.env.PLS_E2E_FRONTEND_PORT ?? '5174';
const backendUrl = `http://127.0.0.1:${backendPort}`;
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
// The production build (service worker, no DEV affordances) for the offline suite (WP 6.2).
const shellPort = process.env.PLS_E2E_SHELL_PORT ?? '5175';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: frontendUrl,
    browserName: 'chromium',
    channel: 'chrome',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // No camera in CI-less local runs: the QR scanner gets a fake device; tests enter tokens
    // through the DEV text fields instead.
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  },
  webServer: [
    {
      command: `dotnet run --project src/Ambulanzsystem.Api/Ambulanzsystem.Api.csproj --launch-profile http -- --urls ${backendUrl}`,
      cwd: '../backend',
      url: `${backendUrl}/health`,
      env: {
        ...process.env,
        ConnectionStrings__Default: `Host=localhost;Port=${dbHostPort};Database=ambulanzsystem;Username=pls;Password=dev-only-password`,
        // Every simulated device logs in from 127.0.0.1; the per-IP login limit is for production.
        RateLimiting__LoginPermitLimit: '200',
      },
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${frontendPort} --strictPort`,
      url: `${frontendUrl}/qrAuthenticator`,
      env: { ...process.env, PLS_BACKEND_URL: backendUrl, VITE_ENABLE_DEV_BUTTONS: 'true' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npm run build && npx vite preview --host 127.0.0.1 --port ${shellPort} --strictPort`,
      url: `http://127.0.0.1:${shellPort}/`,
      env: { ...process.env, PLS_BACKEND_URL: backendUrl },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
