import 'dotenv/config';
import { defineConfig } from 'vitest/config';
import { requireTestDatabaseUrl } from './src/config/test-database.ts';

const testDatabaseUrl = requireTestDatabaseUrl(process.env.TEST_DATABASE_URL);

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl,
      SESSION_SECRET: 'test-only-session-secret-0123456789abcdef-xxxxxxxx',
      JOIN_CODE_KEY: 'test-only-join-code-key-0123456789abcdef-xxxxxxxx',
      FRONTEND_ORIGIN: 'http://localhost:5173',
      LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    },
  },
});
