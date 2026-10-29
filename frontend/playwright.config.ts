import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive the real stack: Vite (proxying /api and /socket.io) → Express → PostgreSQL.
 * Prerequisites: a migrated, seeded dev database and backend/.env (see README). Run with `npm run e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // tests share one database
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    { command: 'npm --prefix ../backend run dev', url: 'http://localhost:4000/health/ready', reuseExistingServer: true, timeout: 60_000 },
    { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 60_000 },
  ],
});
