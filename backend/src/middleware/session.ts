import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pg from 'pg';
import { env, isProd } from '../config/env.ts';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    csrfToken?: string;
    createdAt?: number;
  }
}

const PgStore = connectPgSimple(session);
export const sessionPool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 5 });

export const sessionMiddleware = session({
  store: new PgStore({ pool: sessionPool, tableName: 'user_sessions', createTableIfMissing: false, pruneSessionInterval: 60 * 15 }),
  name: env.SESSION_COOKIE_NAME,
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true, // idle timeout slides; absolute lifetime is enforced in requireAuth
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: env.SESSION_IDLE_MINUTES * 60 * 1000,
  },
});

/** Revoke every server-side session belonging to a user (logout-everywhere, disable, password reset). */
export async function revokeUserSessions(userId: string, exceptSid?: string): Promise<void> {
  await sessionPool.query(
    `DELETE FROM user_sessions WHERE sess->>'userId' = $1 AND ($2::text IS NULL OR sid <> $2)`,
    [userId, exceptSid ?? null],
  );
}
