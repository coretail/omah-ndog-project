import { defineConfig } from "@playwright/test";

const E2E_PORT = 8123;
const E2E_URL = `http://127.0.0.1:${E2E_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: E2E_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run build && ..\\venv\\Scripts\\python.exe e2e\\start_e2e_server.py",
    url: `${E2E_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      STUDIO_PORT: String(E2E_PORT),
      ADMIN_INITIAL_PIN: "482910",
    },
  },
  projects: [
    {
      name: "kiosk-desktop",
      testMatch: /phase4-kiosk-flow\.spec\.ts/,
      use: {
        browserName: "chromium",
        viewport: { width: 1920, height: 1080 },
      },
    },
    {
      name: "mobile-qr",
      testMatch: /phase4-mobile-multidevice\.spec\.ts/,
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "phase5-kiosk",
      testMatch: /phase5-(manual-queue|printer-selection|autoprint-failures)\.spec\.ts/,
      use: {
        browserName: "chromium",
        viewport: { width: 1920, height: 1080 },
      },
    },
    {
      name: "phase5-mobile",
      testMatch: /phase5-mobile-security\.spec\.ts/,
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "phase6-hardening",
      testMatch: /phase6-.*\.spec\.ts/,
      use: {
        browserName: "chromium",
        viewport: { width: 1920, height: 1080 },
      },
    },
  ],
});
