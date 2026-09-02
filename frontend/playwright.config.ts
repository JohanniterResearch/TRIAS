import { defineConfig } from '@playwright/test';

const dbHostPort = process.env.DB_HOST_PORT ?? '5435';
const backendPort = process.env.BACKEND_PORT ?? '5042';
const frontendPort = process.env.FRONTEND_PORT ?? '4200';
const backendUrl = `http://127.0.0.1:${backendPort}`;
const frontendUrl = `http://127.0.0.1:${frontendPort}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  fullyParallel: false,
  reporter: 'line',
  use: {
    baseURL: frontendUrl,
    browserName: 'chromium',
    channel: 'chrome',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `dotnet run --project src/Ambulanzsystem.Api/Ambulanzsystem.Api.csproj --launch-profile http -- --urls ${backendUrl}`,
      cwd: '../backend',
      url: `${backendUrl}/health`,
      env: {
        ...process.env,
        ConnectionStrings__Default: `Host=localhost;Port=${dbHostPort};Database=ambulanzsystem;Username=pls;Password=dev-only-password`,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `bash scripts/run-e2e-dev-server.sh --host 127.0.0.1 --port ${frontendPort}`,
      url: `${frontendUrl}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
