import 'dotenv/config';
import { defineConfig } from 'prisma/config';

import { requireTestDatabaseUrl } from './src/config/test-database.ts';

const datasourceUrl = process.env.TEST_DATABASE_URL
  ? requireTestDatabaseUrl(process.env.TEST_DATABASE_URL)
  : process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: datasourceUrl ? { url: datasourceUrl } : {},
});
