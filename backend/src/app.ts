import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { env, isProd } from './config/env.ts';
import { prisma } from './db.ts';
import { requireAuth } from './middleware/auth.ts';
import { csrfProtection } from './middleware/csrf.ts';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.ts';
import { buildLimiters, defaultLimits, type RateLimits } from './middleware/rateLimit.ts';
import { sessionMiddleware } from './middleware/session.ts';
import { adminRouter } from './modules/admin/admin.routes.ts';
import { analyticsRouter } from './modules/analytics/analytics.routes.ts';
import { authRouter } from './modules/auth/auth.routes.ts';
import { coursesRouter } from './modules/courses/courses.routes.ts';
import { feedbackRouter } from './modules/feedback/feedback.routes.ts';
import { sessionsRouter } from './modules/lecture-sessions/session.routes.ts';
import { pollsRouter } from './modules/polls/poll.routes.ts';
import { usersRouter } from './modules/users/users.routes.ts';
import { logger } from './utils/logger.ts';

export interface AppOptions {
  limits?: Partial<RateLimits>;
}

function requestContext(req: Request, res: Response, next: NextFunction) {
  const supplied = req.get('x-request-id');
  req.requestId = supplied && /^[A-Za-z0-9._-]{8,64}$/.test(supplied) ? supplied : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    logger.info({
      requestId: req.requestId,
      method: req.method,
      path: req.path, // never the query string (may carry tokens)
      status: res.statusCode,
      ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
      userId: req.user?.id,
    }, 'request');
  });
  next();
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(requestContext);

  // The API returns JSON only: lock everything down.
  app.use(
    '/api',
    helmet({
      contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      frameguard: { action: 'deny' },
      hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  );
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    next();
  });

  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  const limiters = buildLimiters({ ...defaultLimits, ...options.limits });
  const v1 = express.Router();
  v1.use(cors({ origin: env.FRONTEND_ORIGIN, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id'], maxAge: 600 }));
  v1.use(limiters.global);
  v1.use(express.json({ limit: '50kb', strict: true }));
  v1.use(sessionMiddleware);
  v1.use(csrfProtection);

  v1.use('/auth', authRouter(limiters));
  // Everything below requires an authenticated, active user (checked once per request).
  v1.use(requireAuth);
  v1.use('/courses', coursesRouter());
  v1.use(sessionsRouter(limiters));
  v1.use(pollsRouter(limiters));
  v1.use(feedbackRouter(limiters));
  v1.use(analyticsRouter(limiters));
  v1.use(usersRouter());
  v1.use(adminRouter());
  app.use('/api/v1', v1);
  app.use('/api', notFoundHandler);

  // Optional: serve the built SPA from this process with a CSP suited to a React/Radix/Recharts app.
  if (env.SERVE_STATIC_DIR && fs.existsSync(path.resolve(env.SERVE_STATIC_DIR, 'index.html'))) {
    const dir = path.resolve(env.SERVE_STATIC_DIR);
    app.use(
      helmet({
        contentSecurityPolicy: {
          useDefaults: false,
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            // Radix/Recharts set inline style attributes; scripts remain strictly self-only.
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
            fontSrc: ["'self'"],
            connectSrc: ["'self'", env.FRONTEND_ORIGIN.replace(/^http/, 'ws')],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            objectSrc: ["'none'"],
          },
        },
        hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
        frameguard: { action: 'deny' },
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      }),
    );
    app.use(express.static(dir, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/|health\/|socket\.io\/).*/, (_req, res) => res.sendFile(path.join(dir, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
