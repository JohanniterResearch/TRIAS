import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  fullyParallel: false,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4200',
    browserName: 'chromium',
    channel: 'chrome',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'dotnet run --project src/Ambulanzsystem.Api/Ambulanzsystem.Api.csproj --launch-profile http',
      cwd: '../backend',
      url: 'http://127.0.0.1:5042/health',
      env: {
        ...process.env,
        ConnectionStrings__Default: 'Host=localhost;Port=5435;Database=ambulanzsystem;Username=pls;Password=dev-only-password',
      },
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npm start -- --host 127.0.0.1 --port 4200',
      url: 'http://127.0.0.1:4200/login',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
