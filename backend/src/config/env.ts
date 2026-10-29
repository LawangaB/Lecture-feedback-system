import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  // Used to HMAC join codes and to encrypt them for lecturer display.
  JOIN_CODE_KEY: z.string().min(32, 'JOIN_CODE_KEY must be at least 32 characters'),
  SESSION_COOKIE_NAME: z.string().default('lfps.sid'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).default(480),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).default(24),
  JOIN_CODE_TTL_MINUTES: z.coerce.number().int().min(5).default(180),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  // Optional: directory with the built frontend, served by this process with an SPA-appropriate CSP.
  SERVE_STATIC_DIR: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (/replace|change-me|example/i.test(env.SESSION_SECRET) || /replace|change-me|example/i.test(env.JOIN_CODE_KEY)) {
      throw new Error('Refusing to start in production with placeholder secrets.');
    }
    if (!env.FRONTEND_ORIGIN.startsWith('https://')) {
      throw new Error('FRONTEND_ORIGIN must be https in production.');
    }
  }
  return env;
}

export const env = load();
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
