import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.ts';
import { env } from './config/env.ts';

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
});

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export * from './generated/prisma/client.ts';
